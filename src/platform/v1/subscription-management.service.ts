import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { prisma } from '@kannan19302/database';
import { ControlPlaneAuditService } from './control-plane-audit.service';
import { Prisma } from '@prisma/client';

export interface SubscriptionTransitionDto {
  planId: string;
  billingPeriod?: 'MONTHLY' | 'YEARLY';
  currency?: string;
  prorate?: boolean;
}

@Injectable()
export class SubscriptionManagementService {
  private readonly logger = new Logger(SubscriptionManagementService.name);

  constructor(private readonly audit: ControlPlaneAuditService) {}

  async getSubscription(tenantId: string) {
    return prisma.tenantSubscription.findUnique({
      where: { tenantId },
      include: {
        plan: { include: { prices: true } },
        invoices: { orderBy: { createdAt: 'desc' }, take: 10 },
      },
    });
  }

  /**
   * Helper to calculate proration amount for plan transitions mid-cycle.
   * Returns { creditAmount, chargeAmount, netAmount }
   */
  calculateProration(
    oldPlanPrice: number,
    newPlanPrice: number,
    periodStart: Date,
    periodEnd: Date,
    effectiveDate: Date = new Date(),
  ) {
    const totalMs = periodEnd.getTime() - periodStart.getTime();
    if (totalMs <= 0) {
      return { creditAmount: 0, chargeAmount: newPlanPrice, netAmount: newPlanPrice };
    }
    const remainingMs = Math.max(0, periodEnd.getTime() - effectiveDate.getTime());
    const fractionRemaining = remainingMs / totalMs;

    const creditAmount = Math.round(oldPlanPrice * fractionRemaining * 100) / 100;
    const chargeAmount = Math.round(newPlanPrice * fractionRemaining * 100) / 100;
    const netAmount = Math.round((chargeAmount - creditAmount) * 100) / 100;

    return { creditAmount, chargeAmount, netAmount };
  }

  async createSubscription(tenantId: string, dto: SubscriptionTransitionDto, actorId: string) {
    return prisma.$transaction(async (tx) => {
      const plan = await tx.saaSPlan.findUniqueOrThrow({ where: { id: dto.planId } });
      const price = await tx.saaSPlanPrice.findFirst({
        where: { planId: dto.planId, currency: dto.currency || 'USD' },
      });
      const amount = dto.billingPeriod === 'YEARLY' ? (price?.yearly.toNumber() || 0) : (price?.monthly.toNumber() || 0);

      const startDate = new Date();
      const endDate = new Date();
      if (dto.billingPeriod === 'YEARLY') {
        endDate.setFullYear(endDate.getFullYear() + 1);
      } else {
        endDate.setMonth(endDate.getMonth() + 1);
      }

      const subscription = await tx.tenantSubscription.upsert({
        where: { tenantId },
        update: {
          planId: dto.planId,
          status: 'ACTIVE',
          billingPeriod: dto.billingPeriod || 'MONTHLY',
          currency: dto.currency || 'USD',
          startDate,
          endDate,
        },
        create: {
          tenantId,
          planId: dto.planId,
          status: 'ACTIVE',
          billingPeriod: dto.billingPeriod || 'MONTHLY',
          currency: dto.currency || 'USD',
          startDate,
          endDate,
        },
      });

      // Produce invoice line
      const invoiceNumber = `INV-${tenantId.slice(0, 5).toUpperCase()}-${Date.now()}`;
      await tx.saaSInvoice.create({
        data: {
          tenantId,
          subscriptionId: subscription.id,
          invoiceNumber,
          status: 'PAID',
          currency: dto.currency || 'USD',
          subtotal: amount,
          totalAmount: amount,
          amountPaid: amount,
          periodStart: startDate,
          periodEnd: endDate,
          lines: {
            create: [
              {
                description: `Initial Subscription: ${plan.name} (${dto.billingPeriod || 'MONTHLY'})`,
                type: 'PLAN',
                quantity: 1,
                unitPrice: amount,
                totalPrice: amount,
              },
            ],
          },
        },
      });

      await this.audit.record(
        {
          actorId,
          actorRole: 'SUPER_ADMIN',
          action: 'subscription.create',
          targetId: tenantId,
          details: { dto, amount },
        },
        tx as any,
      );

      return subscription;
    });
  }

  async transitionSubscription(tenantId: string, dto: SubscriptionTransitionDto, actorId: string) {
    return prisma.$transaction(async (tx) => {
      const current = await tx.tenantSubscription.findUniqueOrThrow({
        where: { tenantId },
        include: { plan: { include: { prices: true } } },
      });

      const newPlan = await tx.saaSPlan.findUniqueOrThrow({ where: { id: dto.planId } });
      const currency = dto.currency || current.currency;
      const billingPeriod = dto.billingPeriod || (current.billingPeriod as 'MONTHLY' | 'YEARLY');

      const oldPriceObj = current.plan.prices.find((p) => p.currency === currency);
      const oldPrice = billingPeriod === 'YEARLY' ? (oldPriceObj?.yearly.toNumber() || 0) : (oldPriceObj?.monthly.toNumber() || 0);

      const newPriceObj = await tx.saaSPlanPrice.findFirst({
        where: { planId: dto.planId, currency },
      });
      const newPrice = billingPeriod === 'YEARLY' ? (newPriceObj?.yearly.toNumber() || 0) : (newPriceObj?.monthly.toNumber() || 0);

      const periodStart = current.startDate || new Date();
      const periodEnd = current.endDate || new Date(Date.now() + 30 * 86400000);
      const proration = this.calculateProration(oldPrice, newPrice, periodStart, periodEnd);

      const now = new Date();
      const updated = await tx.tenantSubscription.update({
        where: { tenantId },
        data: {
          planId: dto.planId,
          billingPeriod,
          currency,
          status: 'ACTIVE',
        },
      });

      // Invoice generation with proration lines
      const invoiceNumber = `INV-${tenantId.slice(0, 5).toUpperCase()}-${Date.now()}`;
      const lineItems: any[] = [];

      if (proration.creditAmount > 0) {
        lineItems.push({
          description: `Unused time on ${current.plan.name} credit`,
          type: 'CREDIT',
          quantity: 1,
          unitPrice: -proration.creditAmount,
          totalPrice: -proration.creditAmount,
        });
      }

      lineItems.push({
        description: `Plan Transition: ${newPlan.name} (${billingPeriod})`,
        type: 'PLAN',
        quantity: 1,
        unitPrice: proration.chargeAmount,
        totalPrice: proration.chargeAmount,
      });

      await tx.saaSInvoice.create({
        data: {
          tenantId,
          subscriptionId: current.id,
          invoiceNumber,
          status: proration.netAmount <= 0 ? 'PAID' : 'PENDING',
          currency,
          subtotal: proration.netAmount,
          totalAmount: Math.max(0, proration.netAmount),
          amountDue: Math.max(0, proration.netAmount),
          periodStart: now,
          periodEnd,
          lines: { create: lineItems },
        },
      });

      await this.audit.record(
        {
          actorId,
          actorRole: 'SUPER_ADMIN',
          action: 'subscription.transition',
          targetId: tenantId,
          details: { fromPlanId: current.planId, toPlanId: dto.planId, proration },
        },
        tx as any,
      );

      return updated;
    });
  }

  async pauseSubscription(tenantId: string, actorId: string) {
    return prisma.$transaction(async (tx) => {
      const now = new Date();
      const updated = await tx.tenantSubscription.update({
        where: { tenantId },
        data: {
          status: 'PAUSED',
          pauseStart: now,
        },
      });

      await this.audit.record(
        {
          actorId,
          actorRole: 'SUPER_ADMIN',
          action: 'subscription.pause',
          targetId: tenantId,
          details: { pauseStart: now },
        },
        tx as any,
      );

      return updated;
    });
  }

  async winBackOrResume(tenantId: string, actorId: string) {
    return prisma.$transaction(async (tx) => {
      const updated = await tx.tenantSubscription.update({
        where: { tenantId },
        data: {
          status: 'ACTIVE',
          cancelledAt: null,
          pauseStart: null,
          pauseEnd: null,
        },
      });

      await this.audit.record(
        {
          actorId,
          actorRole: 'SUPER_ADMIN',
          action: 'subscription.resume',
          targetId: tenantId,
          details: { resumedAt: new Date() },
        },
        tx as any,
      );

      return updated;
    });
  }

  async cancelSubscription(tenantId: string, actorId: string) {
    return prisma.$transaction(async (tx) => {
      const now = new Date();
      const updated = await tx.tenantSubscription.update({
        where: { tenantId },
        data: {
          status: 'CANCELLED',
          cancelledAt: now,
        },
      });

      await this.audit.record(
        {
          actorId,
          actorRole: 'SUPER_ADMIN',
          action: 'subscription.cancel',
          targetId: tenantId,
          details: { cancelledAt: now },
        },
        tx as any,
      );

      return updated;
    });
  }
}
