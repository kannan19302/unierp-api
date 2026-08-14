import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import { prisma } from "@kannan19302/database";
import { idpClient as idpPrisma } from "@/common/idp-client";
import { Prisma } from "@prisma/client";

export interface ProrationResult {
  proratedCredit: number;
  proratedCharge: number;
  daysInPeriod: number;
  daysUsed: number;
  daysRemaining: number;
}

@Injectable()
export class SubscriptionMigrationService {
  async getMigrations(tenantId: string, subscriptionId?: string) {
    const where: Record<string, unknown> = { tenantId };
    if (subscriptionId) where.subscriptionId = subscriptionId;
    return prisma.subscriptionMigration.findMany({
      where,
      orderBy: { effectiveDate: "desc" },
    });
  }

  calculateProration(
    currentPeriodStart: Date,
    currentPeriodEnd: Date,
    effectiveDate: Date,
    currentUnitAmount: number,
    newUnitAmount: number,
    quantity: number,
  ): ProrationResult {
    const periodStart = new Date(currentPeriodStart);
    const periodEnd = new Date(currentPeriodEnd);
    const effective = new Date(effectiveDate);

    if (effective < periodStart || effective > periodEnd) {
      throw new BadRequestException("Effective date must be within current billing period");
    }

    // Calculate total days in period (inclusive of both start and end)
    const totalMs = periodEnd.getTime() - periodStart.getTime();
    const totalDays = Math.ceil(totalMs / (1000 * 60 * 60 * 24)) + 1;

    // Calculate days used (inclusive of period start and effective date)
    const usedMs = effective.getTime() - periodStart.getTime();
    const daysUsed = Math.ceil(usedMs / (1000 * 60 * 60 * 24)) + 1;

    // Days remaining = total - used
    const daysRemaining = Math.max(0, totalDays - daysUsed);

    const dailyRateOld = currentUnitAmount / totalDays;
    const dailyRateNew = newUnitAmount / totalDays;

    const proratedCredit = Math.round(dailyRateOld * daysRemaining * quantity * 100) / 100;
    const proratedCharge = Math.round(dailyRateNew * daysRemaining * quantity * 100) / 100;

    return {
      proratedCredit,
      proratedCharge,
      daysInPeriod: totalDays,
      daysUsed,
      daysRemaining,
    };
  }

  async migrate(
    tenantId: string,
    subscriptionId: string,
    initiatedBy: string,
    dto: {
      toPlanTierId: string;
      effectiveDate: string;
      reason?: string;
    },
  ) {
    const sub = await prisma.subscription.findFirst({
      where: { tenantId, id: subscriptionId },
    });
    if (!sub) throw new NotFoundException("Subscription not found");
    const newPlan = await prisma.subscriptionPlanTier.findFirst({
      where: { tenantId, id: dto.toPlanTierId },
    });
    if (!newPlan) throw new NotFoundException("Target plan not found");

    const currentPeriodStart = sub.currentPeriodStart ? new Date(sub.currentPeriodStart) : new Date();
    const currentPeriodEnd = sub.currentPeriodEnd ? new Date(sub.currentPeriodEnd) : new Date();

    const migrationType =
      Number(newPlan.monthlyPrice) >= Number(sub.unitAmount)
        ? "UPGRADE"
        : "DOWNGRADE";

    const proration = this.calculateProration(
      currentPeriodStart,
      currentPeriodEnd,
      new Date(dto.effectiveDate),
      Number(sub.unitAmount),
      Number(newPlan.monthlyPrice),
      sub.quantity,
    );

    return prisma.$transaction(async (tx) => {
      const migration = await tx.subscriptionMigration.create({
        data: {
          tenantId,
          subscriptionId,
          fromPlanTierId: null,
          toPlanTierId: dto.toPlanTierId,
          migrationType,
          effectiveDate: new Date(dto.effectiveDate),
          proratedCredit: new Prisma.Decimal(proration.proratedCredit),
          proratedCharge: new Prisma.Decimal(proration.proratedCharge),
          previousUnitAmount: sub.unitAmount,
          newUnitAmount: newPlan.monthlyPrice,
          reason: dto.reason,
          initiatedBy,
        },
      });
      await tx.subscription.update({
        where: { id: subscriptionId },
        data: { unitAmount: newPlan.monthlyPrice, updatedAt: new Date() },
      });
      return { migration, proration };
    });
  }

  async getMigrationStats(tenantId: string) {
    const [total, upgrades, downgrades] = await Promise.all([
      prisma.subscriptionMigration.count({ where: { tenantId } }),
      prisma.subscriptionMigration.count({
        where: { tenantId, migrationType: "UPGRADE" },
      }),
      prisma.subscriptionMigration.count({
        where: { tenantId, migrationType: "DOWNGRADE" },
      }),
    ]);
    return {
      total,
      upgrades,
      downgrades,
      upgradeRatio: total > 0 ? Math.round((upgrades / total) * 100) : 0,
    };
  }
}
