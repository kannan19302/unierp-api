/**
 * M30 — reconciles a provider's OWN reported consumption against C14's
 * metered quantity. "Extends C14's reconciliation view; does not fork
 * it": this service reads C14's own MeteringEvent rows directly (the
 * same events `MeteringService.getEvents()` exposes) rather than
 * maintaining a second metering pipeline, and its variance report is an
 * ADDITIONAL view over the same events — provider-vs-metered — sitting
 * beside C14's own event-vs-snapshot reconciliation, not replacing it.
 */
import { Injectable } from "@nestjs/common";
import { prisma } from "@kannan19302/database";

export interface VarianceReport {
  tenantId: string;
  metric: string;
  period: string;
  /** Named explicitly — "both sources named" is the exit criterion's
   *  own phrase, not left implicit in a bare number. */
  meteredSource: "C14 metering events";
  meteredQuantity: number;
  /** Drill-down: the exact MeteringEvent ids summed to reach the metered
   *  quantity. */
  meteredEventIds: string[];
  providerSource: string;
  providerQuantity: number;
  /** Drill-down: the exact ProviderConsumptionReport row. */
  providerReportId: string | null;
  variance: number;
  diverged: boolean;
}

@Injectable()
export class ProviderMeteringReconciliationService {
  async recordProviderConsumption(providerId: string, tenantId: string, metric: string, period: string, reportedQuantity: number) {
    return (prisma as any).providerConsumptionReport.upsert({
      where: { providerId_tenantId_metric_period: { providerId, tenantId, metric, period } },
      create: { providerId, tenantId, metric, period, reportedQuantity },
      update: { reportedQuantity, reportedAt: new Date() },
    });
  }

  /**
   * "A deliberate divergence... is detected and reported with both
   * sources named" — this is the exact comparison, with full drill-down
   * on both sides: the metered side names every contributing event id,
   * the provider side names the exact report row.
   */
  async reconcile(providerId: string, tenantId: string, metric: string, period: string): Promise<VarianceReport> {
    const [start, end] = periodBounds(period);

    // The same MeteringEvent table C14's own reconcile() and getEvents()
    // read — no second event log.
    const events = await (prisma as any).meteringEvent.findMany({
      where: { tenantId, metric, timestamp: { gte: start, lt: end } },
    });
    const meteredQuantity = events.reduce((sum: number, e: any) => sum + e.quantity, 0);

    const report = await (prisma as any).providerConsumptionReport.findUnique({
      where: { providerId_tenantId_metric_period: { providerId, tenantId, metric, period } },
    });
    const providerQuantity = report?.reportedQuantity ?? 0;

    const variance = meteredQuantity - providerQuantity;

    return {
      tenantId,
      metric,
      period,
      meteredSource: "C14 metering events",
      meteredQuantity,
      meteredEventIds: events.map((e: any) => e.id),
      providerSource: providerId,
      providerQuantity,
      providerReportId: report?.id ?? null,
      variance,
      diverged: variance !== 0,
    };
  }
}

function periodBounds(period: string): [Date, Date] {
  const [year, month] = period.split("-").map(Number);
  return [new Date(Date.UTC(year!, month! - 1, 1)), new Date(Date.UTC(year!, month!, 1))];
}
