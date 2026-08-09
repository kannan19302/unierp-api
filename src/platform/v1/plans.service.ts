import { Injectable, Logger } from '@nestjs/common';
import { prisma } from '@kannan19302/database';
import { ControlPlaneAuditService } from './control-plane-audit.service';
import { Prisma } from '@prisma/client';

export interface CreatePlanDto {
  name: string;
  maxUsers: number;
  maxStorage: number;
  maxApiCalls: number;
  features: Record<string, boolean>;
  description?: string;
  isPublic?: boolean;
}

export interface UpdatePlanDto {
  name?: string;
  maxUsers?: number;
  maxStorage?: number;
  maxApiCalls?: number;
  features?: Record<string, boolean>;
  description?: string;
  isPublic?: boolean;
  status?: string;
}

export interface PriceDto {
  currency: string;
  region: string;
  monthly: number;
  yearly: number;
  stripePriceId?: string;
}

@Injectable()
export class PlansService {
  private readonly logger = new Logger(PlansService.name);

  constructor(
    private readonly audit: ControlPlaneAuditService,
  ) {}

  async listPlans(includeArchived = false) {
    return prisma.saaSPlan.findMany({
      where: includeArchived ? {} : { status: { not: 'ARCHIVED' } },
      include: { prices: true, featureEntitlements: true },
      orderBy: { sortOrder: 'asc' },
    });
  }

  async getPlan(id: string) {
    return prisma.saaSPlan.findUniqueOrThrow({
      where: { id },
      include: { prices: true, featureEntitlements: true },
    });
  }

  async createPlan(dto: CreatePlanDto, actorId: string) {
    return prisma.$transaction(async (tx) => {
      const plan = await tx.saaSPlan.create({
        data: {
          name: dto.name,
          maxUsers: dto.maxUsers,
          maxStorage: dto.maxStorage,
          maxApiCalls: dto.maxApiCalls,
          features: dto.features as Prisma.JsonObject,
          description: dto.description,
          isPublic: dto.isPublic ?? true,
          version: 1,
        } as any,
      });

      await this.audit.record(
        {
          actorId,
          actorRole: 'SUPER_ADMIN',
          action: 'plan.create',
          targetId: plan.id,
          details: { dto },
        },
        tx as any,
      );

      return plan;
    });
  }

  async updatePlan(id: string, dto: UpdatePlanDto, actorId: string, reason: string) {
    return prisma.$transaction(async (tx) => {
      const existing = await tx.saaSPlan.findUniqueOrThrow({ where: { id } }) as any;

      // Create a new version
      const newPlan = await tx.saaSPlan.create({
        data: {
          name: dto.name ?? existing.name,
          maxUsers: dto.maxUsers ?? existing.maxUsers,
          maxStorage: dto.maxStorage ?? existing.maxStorage,
          maxApiCalls: dto.maxApiCalls ?? existing.maxApiCalls,
          features: (dto.features ?? existing.features) as Prisma.JsonObject,
          description: dto.description ?? existing.description,
          isPublic: dto.isPublic ?? existing.isPublic,
          sortOrder: existing.sortOrder,
          status: dto.status ?? 'ACTIVE',
          version: (existing.version || 1) + 1,
        } as any,
      });

      // Mark old as grandfathered
      await tx.saaSPlan.update({
        where: { id },
        data: {
          status: 'GRANDFATHERED',
          supersededBy: newPlan.id,
        } as any,
      });

      // Copy prices to new plan
      const prices = await tx.saaSPlanPrice.findMany({ where: { planId: id } });
      if (prices.length > 0) {
        await tx.saaSPlanPrice.createMany({
          data: prices.map((p: any) => ({
            planId: newPlan.id,
            currency: p.currency,
            region: p.region,
            monthly: p.monthly,
            yearly: p.yearly,
            stripePriceId: p.stripePriceId,
            isActive: p.isActive,
          })),
        });
      }

      await this.audit.record(
        {
          actorId,
          actorRole: 'SUPER_ADMIN',
          action: 'plan.update',
          targetId: newPlan.id,
          details: { oldPlanId: id, dto },
        },
        tx as any,
      );

      return newPlan;
    });
  }

  async setPlanPrices(planId: string, prices: PriceDto[], actorId: string, reason: string) {
    return prisma.$transaction(async (tx) => {
      // Create new plan version to avoid mutating price on existing subscriptions
      const existing = await tx.saaSPlan.findUniqueOrThrow({ where: { id: planId } }) as any;

      const newPlan = await tx.saaSPlan.create({
        data: {
          name: existing.name,
          maxUsers: existing.maxUsers,
          maxStorage: existing.maxStorage,
          maxApiCalls: existing.maxApiCalls,
          features: existing.features as Prisma.JsonObject,
          description: existing.description,
          isPublic: existing.isPublic,
          sortOrder: existing.sortOrder,
          status: 'ACTIVE',
          version: (existing.version || 1) + 1,
        } as any,
      });

      await tx.saaSPlan.update({
        where: { id: planId },
        data: {
          status: 'GRANDFATHERED',
          supersededBy: newPlan.id,
        } as any,
      });

      await tx.saaSPlanPrice.createMany({
        data: prices.map(p => ({
          planId: newPlan.id,
          currency: p.currency,
          region: p.region,
          monthly: p.monthly,
          yearly: p.yearly,
          stripePriceId: p.stripePriceId,
        })),
      });

      await this.audit.record(
        {
          actorId,
          actorRole: 'SUPER_ADMIN',
          action: 'plan.prices.update',
          targetId: newPlan.id,
          details: { oldPlanId: planId, prices },
        },
        tx as any,
      );

      return newPlan;
    });
  }
}
