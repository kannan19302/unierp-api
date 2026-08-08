import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { prisma } from '@kannan19302/database';
import { ControlPlaneAuditService } from './control-plane-audit.service';

/**
 * C18 - Quota & Limit Administration
 * Manages quota rules per plan/add-on, enforces warning thresholds,
 * and logs alerts when usage approaches limits.
 */
@Injectable()
export class QuotaAdminService {
  private readonly logger = new Logger(QuotaAdminService.name);

  constructor(private readonly audit: ControlPlaneAuditService) {}

  async listQuotaRules(planId?: string) {
    return prisma.quotaRule.findMany({
      where: planId ? { planId } : undefined,
      include: { plan: true, addon: true },
      orderBy: { metric: 'asc' },
    });
  }

  async setQuotaRule(dto: {
    planId?: string;
    addonId?: string;
    metric: string;
    limitValue: number;
    pricePerUnit?: number;
    billingThreshold?: number;
  }, actorId: string) {
    if (!dto.planId && !dto.addonId) {
      throw new BadRequestException('Either planId or addonId must be specified');
    }
    if (dto.limitValue < 0) {
      throw new BadRequestException('limitValue must be non-negative');
    }

    const rule = await prisma.quotaRule.upsert({
      where: {
        // Using compound unique on planId + metric approach: create or update
        id: 'new',
      },
      update: {},
      create: {
        planId: dto.planId,
        addonId: dto.addonId,
        metric: dto.metric,
        limitValue: dto.limitValue,
        pricePerUnit: dto.pricePerUnit ?? 0,
        billingThreshold: dto.billingThreshold ?? 0,
      },
    }).catch(async () => {
      // Fallback: just create a new rule
      return prisma.quotaRule.create({
        data: {
          planId: dto.planId,
          addonId: dto.addonId,
          metric: dto.metric,
          limitValue: dto.limitValue,
          pricePerUnit: dto.pricePerUnit ?? 0,
          billingThreshold: dto.billingThreshold ?? 0,
        },
      });
    });

    await this.audit.record({
      actorId,
      actorRole: 'SUPER_ADMIN',
      action: 'quota.rule.set',
      targetId: rule.id,
      details: dto,
    });

    return rule;
  }

  async getUsageWithQuotas(tenantId: string) {
    const [usageRecords, sub] = await Promise.all([
      prisma.usageRecord.findMany({ where: { tenantId } }),
      prisma.tenantSubscription.findUnique({
        where: { tenantId },
        include: { plan: { include: { quotaRules: true } } },
      }),
    ]);

    const quotaRules = sub?.plan?.quotaRules ?? [];

    return usageRecords.map((usage) => {
      const rule = quotaRules.find((r) => r.metric === usage.metric);
      const limit = rule?.limitValue ?? usage.limitValue;
      const pct = limit > 0 ? Math.round((usage.currentValue / limit) * 100) : 0;
      return {
        metric: usage.metric,
        currentValue: usage.currentValue,
        limitValue: limit,
        usagePct: pct,
        warningThreshold: rule?.billingThreshold ?? 80,
        isWarning: pct >= (rule?.billingThreshold ?? 80),
        isExceeded: usage.currentValue > limit,
      };
    });
  }

  async logUsageAlert(tenantId: string, metric: string, currentValue: number, limitValue: number, actorId: string) {
    const pct = limitValue > 0 ? Math.round((currentValue / limitValue) * 100) : 100;
    const alertLevel = pct >= 100 ? 'EXCEEDED' : 'WARNING';

    await prisma.usageAlertLog.create({
      data: {
        tenantId,
        metric,
        currentValue,
        limitValue,
        level: pct >= 100 ? 'CRITICAL' : 'WARNING',
        message: `Quota alert for ${metric}: ${currentValue}/${limitValue} (${pct}%)`,
      },
    });

    await this.audit.record({
      actorId,
      actorRole: 'SYSTEM',
      action: 'quota.alert.fired',
      targetId: tenantId,
      details: { metric, currentValue, limitValue, pct },
    });

    return { tenantId, metric, pct, alertType: pct >= 100 ? 'EXCEEDED' : 'WARNING' };
  }
}
