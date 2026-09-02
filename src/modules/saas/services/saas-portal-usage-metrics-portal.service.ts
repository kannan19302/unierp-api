import { Injectable } from "@nestjs/common";
import { prisma } from "@kannan19302/database";

/**
 * D21 — "A tenant sees the same usage figure the invoice was computed
 * from." getUsageDashboard() now reads the REAL UsageRecord table —
 * the identical table BillingService's own overage/invoice computation
 * (getUsageSummary/computeCurrentCycleCost) reads — never a second,
 * disconnected dashboard dataset a tenant's view could silently diverge
 * from what their invoice was actually computed from.
 */
@Injectable()
export class SaasPortalUsageMetricsPortalService {
  async getUsageDashboard(tenantId: string) {
    const records = await (prisma as any).usageRecord.findMany({ where: { tenantId } });
    return records.map((r: any) => ({
      metric: r.metric,
      currentValue: r.currentValue,
      limitValue: r.limitValue,
      percentUsed: r.limitValue > 0 ? Number(((r.currentValue / r.limitValue) * 100).toFixed(2)) : 0,
      isOverLimit: r.currentValue > r.limitValue,
      tenantId: r.tenantId,
      updatedAt: r.updatedAt,
    }));
  }
}
