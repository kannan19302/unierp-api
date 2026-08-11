/**
 * M27 — thin DB-backed wrapper test: proves CostAllocationService fetches
 * a real M25 batch and a real M18 attribution table and hands them,
 * unmodified, to the pure allocateLineItems() function this service
 * deliberately contains no arithmetic of its own.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

let batches: any[];
let lineItems: any[];
let attributions: any[];

vi.mock("@kannan19302/database", () => ({
  prisma: {
    costIngestionBatch: {
      findUnique: vi.fn(({ where }: any) => {
        const k = where.providerId_period;
        const batch = batches.find((b) => b.providerId === k.providerId && b.period === k.period);
        if (!batch) return null;
        return { ...batch, lineItems: lineItems.filter((li) => li.batchId === batch.id) };
      }),
    },
    resourceAttribution: {
      findMany: vi.fn(() => attributions),
    },
  },
}));

import { CostAllocationService } from "./cost-allocation.service";

describe("M27 · CostAllocationService (DB wrapper)", () => {
  let allocation: CostAllocationService;

  beforeEach(() => {
    vi.clearAllMocks();
    batches = [];
    lineItems = [];
    attributions = [];
    allocation = new CostAllocationService();
  });

  it("allocates a real batch using M18's attribution table, allocated + unallocated summing to the ingested total", async () => {
    batches.push({ id: "batch-1", providerId: "aws", period: "2026-08" });
    lineItems.push(
      { id: "li-1", batchId: "batch-1", amount: { toString: () => "100.0000" }, resourceId: "res-1", sharedResourceIds: null },
      { id: "li-2", batchId: "batch-1", amount: { toString: () => "25.0000" }, resourceId: "res-unattributed", sharedResourceIds: null },
    );
    attributions.push({ resourceId: "res-1", tenantId: "tenant-1", service: "billing", environment: "prod", owner: "team-a" });

    const result = await allocation.allocateBatch("aws", "2026-08");

    expect(result.allocated).toHaveLength(1);
    expect(result.allocated[0]!.tenantId).toBe("tenant-1");
    expect(result.unallocated).toHaveLength(1);
    expect(result.allocatedTotal).toBe("100.0000");
    expect(result.unallocatedTotal).toBe("25.0000");
    expect(result.ingestedTotal).toBe("125.0000");
  });

  it("a partial attribution row (missing owner) is treated as unattributed, same as M18's own rule", async () => {
    batches.push({ id: "batch-2", providerId: "gcp", period: "2026-08" });
    lineItems.push({ id: "li-1", batchId: "batch-2", amount: { toString: () => "10.0000" }, resourceId: "res-partial", sharedResourceIds: null });
    attributions.push({ resourceId: "res-partial", tenantId: "tenant-1", service: "svc", environment: "prod", owner: null });

    const result = await allocation.allocateBatch("gcp", "2026-08");
    expect(result.allocated).toHaveLength(0);
    expect(result.unallocated).toHaveLength(1);
  });

  it("throws when no batch was ingested for the requested provider/period", async () => {
    await expect(allocation.allocateBatch("aws", "2099-01")).rejects.toThrow(/No ingested batch/);
  });
});
