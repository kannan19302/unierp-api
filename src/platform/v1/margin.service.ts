/**
 * M28 — cost per tenant, margin and unit economics. This is the phase
 * K19 depends on: gross margin stated with BOTH sides traceable —
 * cost to M25's ingested lines (via M27's allocation, never a rolled-up
 * number with nothing under it) and revenue to C16's invoice rows.
 */
import { Injectable } from "@nestjs/common";
import { prisma } from "@kannan19302/database";
import { CostAllocationService } from "./cost-allocation.service";
import { toCents, centsToDecimalString } from "./cost-allocation";

export interface TenantMargin {
  tenantId: string;
  period: string;
  /** Decimal strings — never numbers. */
  cost: string;
  revenue: string;
  margin: string;
  /** true when cost exceeds revenue — surfaced explicitly, not left for
   *  the caller to notice a negative sign. */
  atRisk: boolean;
  /** M25 CostLineItem ids this cost traces back to, via M27's allocation. */
  costTraceLineItemIds: string[];
  /** C16 SaaSInvoice ids this revenue traces back to. */
  revenueTraceInvoiceIds: string[];
}

@Injectable()
export class MarginService {
  constructor(private readonly costAllocation: CostAllocationService) {}

  async getTenantMargin(tenantId: string, period: string): Promise<TenantMargin> {
    const { totalCost, sourceLineItemIds } = await this.costAllocation.getTenantCostForPeriod(tenantId, period);

    // period is "YYYY-MM" — the same shape M25's CostIngestionBatch uses.
    const [year, month] = period.split("-").map(Number);
    const periodStart = new Date(Date.UTC(year!, month! - 1, 1));
    const periodEnd = new Date(Date.UTC(year!, month!, 1));

    const invoices = await (prisma as any).saaSInvoice.findMany({
      where: { tenantId, periodStart: { gte: periodStart, lt: periodEnd } },
    });

    const revenueCents = invoices.reduce((sum: bigint, inv: any) => sum + toCents(inv.totalAmount.toString()), 0n);
    const costCents = toCents(totalCost);
    const marginCents = revenueCents - costCents;

    return {
      tenantId,
      period,
      cost: centsToDecimalString(costCents),
      revenue: centsToDecimalString(revenueCents),
      margin: centsToDecimalString(marginCents),
      atRisk: marginCents < 0n,
      costTraceLineItemIds: sourceLineItemIds,
      revenueTraceInvoiceIds: invoices.map((inv: any) => inv.id),
    };
  }
}
