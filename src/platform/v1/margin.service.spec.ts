/**
 * M28 exit criterion: "The gross margin of any tenant is stated with
 * both sides traceable — cost to M25's ingested line, revenue to C16's
 * invoice. A tenant whose cost exceeds its revenue is surfaced. This is
 * the phase K19 depends on."
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

let batches: any[];
let lineItems: any[];
let attributions: any[];
let invoices: any[];

vi.mock("@kannan19302/database", () => ({
  prisma: {
    costIngestionBatch: {
      findMany: vi.fn(({ where }: any) => batches.filter((b) => b.period === where.period)),
      findUnique: vi.fn(({ where }: any) => {
        const k = where.providerId_period;
        const batch = batches.find((b) => b.providerId === k.providerId && b.period === k.period);
        if (!batch) return null;
        return { ...batch, lineItems: lineItems.filter((li) => li.batchId === batch.id) };
      }),
    },
    resourceAttribution: { findMany: vi.fn(() => attributions) },
    saaSInvoice: {
      findMany: vi.fn(({ where }: any) =>
        invoices.filter(
          (inv) =>
            inv.tenantId === where.tenantId &&
            new Date(inv.periodStart) >= where.periodStart.gte &&
            new Date(inv.periodStart) < where.periodStart.lt,
        ),
      ),
    },
  },
}));

import { CostAllocationService } from "./cost-allocation.service";
import { MarginService } from "./margin.service";

describe("M28 · cost per tenant, margin and unit economics", () => {
  let margin: MarginService;

  beforeEach(() => {
    vi.clearAllMocks();
    batches = [];
    lineItems = [];
    attributions = [];
    invoices = [];
    margin = new MarginService(new CostAllocationService());
  });

  it("gross margin is stated with BOTH sides traceable — cost to M25's line, revenue to C16's invoice", async () => {
    batches.push({ id: "batch-1", providerId: "aws", period: "2026-08" });
    lineItems.push({ id: "li-1", batchId: "batch-1", amount: { toString: () => "300.0000" }, resourceId: "res-1", sharedResourceIds: null });
    attributions.push({ resourceId: "res-1", tenantId: "tenant-1", service: "billing", environment: "prod", owner: "team-a" });
    invoices.push({ id: "inv-1", tenantId: "tenant-1", periodStart: new Date("2026-08-01"), totalAmount: { toString: () => "1000.00" } });

    const result = await margin.getTenantMargin("tenant-1", "2026-08");

    expect(result.cost).toBe("300.0000");
    expect(result.revenue).toBe("1000.0000");
    expect(result.margin).toBe("700.0000");
    expect(result.atRisk).toBe(false);

    // Traceability: not just numbers, the actual source rows.
    expect(result.costTraceLineItemIds).toEqual(["li-1"]);
    expect(result.revenueTraceInvoiceIds).toEqual(["inv-1"]);
  });

  it("a tenant whose cost EXCEEDS its revenue is surfaced (atRisk), not silently reported as a negative number to be noticed", async () => {
    batches.push({ id: "batch-2", providerId: "aws", period: "2026-08" });
    lineItems.push({ id: "li-2", batchId: "batch-2", amount: { toString: () => "5000.0000" }, resourceId: "res-2", sharedResourceIds: null });
    attributions.push({ resourceId: "res-2", tenantId: "tenant-loss", service: "svc", environment: "prod", owner: "team-b" });
    invoices.push({ id: "inv-2", tenantId: "tenant-loss", periodStart: new Date("2026-08-01"), totalAmount: { toString: () => "999.00" } });

    const result = await margin.getTenantMargin("tenant-loss", "2026-08");

    expect(result.atRisk).toBe(true);
    expect(result.margin).toBe("-4001.0000");
  });

  it("aggregates cost across MULTIPLE providers for the same period, all traceable", async () => {
    batches.push(
      { id: "batch-aws", providerId: "aws", period: "2026-08" },
      { id: "batch-gcp", providerId: "gcp", period: "2026-08" },
    );
    lineItems.push(
      { id: "li-aws", batchId: "batch-aws", amount: { toString: () => "100.0000" }, resourceId: "res-aws", sharedResourceIds: null },
      { id: "li-gcp", batchId: "batch-gcp", amount: { toString: () => "50.0000" }, resourceId: "res-gcp", sharedResourceIds: null },
    );
    attributions.push(
      { resourceId: "res-aws", tenantId: "tenant-multi", service: "svc", environment: "prod", owner: "team-a" },
      { resourceId: "res-gcp", tenantId: "tenant-multi", service: "svc", environment: "prod", owner: "team-a" },
    );
    invoices.push({ id: "inv-3", tenantId: "tenant-multi", periodStart: new Date("2026-08-15"), totalAmount: { toString: () => "500.00" } });

    const result = await margin.getTenantMargin("tenant-multi", "2026-08");

    expect(result.cost).toBe("150.0000");
    expect(result.costTraceLineItemIds.sort()).toEqual(["li-aws", "li-gcp"]);
  });

  it("a tenant with no cost and no revenue for the period reports a zero, traceable margin", async () => {
    const result = await margin.getTenantMargin("tenant-empty", "2026-08");
    expect(result.cost).toBe("0.0000");
    expect(result.revenue).toBe("0.0000");
    expect(result.margin).toBe("0.0000");
    expect(result.atRisk).toBe(false);
    expect(result.costTraceLineItemIds).toEqual([]);
    expect(result.revenueTraceInvoiceIds).toEqual([]);
  });
});
