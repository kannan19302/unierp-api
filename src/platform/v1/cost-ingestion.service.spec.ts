/**
 * M25 exit criterion: "An ingested month reconciles to the provider's own
 * invoice total to the cent. Money is Decimal(19,4) throughout; a Float
 * in this path fails the build. Re-ingesting the same period does not
 * double-count — asserted."
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

let batches: any[];
let lineItems: any[];
let seq = 0;
const nextId = (p: string) => `${p}-${++seq}`;

vi.mock("@kannan19302/database", () => ({
  prisma: {
    costIngestionBatch: {
      findUnique: vi.fn(({ where }: any) => {
        const k = where.providerId_period;
        return batches.find((b) => b.providerId === k.providerId && b.period === k.period) ?? null;
      }),
      create: vi.fn(({ data }: any) => {
        const row = { id: nextId("batch"), ingestedAt: new Date(), ...data };
        batches.push(row);
        return row;
      }),
      update: vi.fn(({ where: { id }, data }: any) => {
        const row = batches.find((b) => b.id === id)!;
        Object.assign(row, data);
        return row;
      }),
    },
    costLineItem: {
      create: vi.fn(({ data }: any) => {
        const row = { id: nextId("li"), ...data };
        lineItems.push(row);
        return row;
      }),
      deleteMany: vi.fn(({ where }: any) => {
        lineItems = lineItems.filter((li) => li.batchId !== where.batchId);
      }),
    },
  },
}));

import { CostIngestionService } from "./cost-ingestion.service";

describe("M25 · provider billing and cost ingestion", () => {
  let ingestion: CostIngestionService;

  beforeEach(() => {
    vi.clearAllMocks();
    batches = [];
    lineItems = [];
    ingestion = new CostIngestionService();
  });

  it("an ingested month reconciles to the provider's own invoice total to the cent", async () => {
    const result = await ingestion.ingestBillingExport({
      providerId: "aws",
      period: "2026-08",
      currency: "USD",
      invoiceTotal: "1234.56",
      lineItems: [
        { sourceLineId: "L1", description: "EC2", amount: "800.11" },
        { sourceLineId: "L2", description: "S3", amount: "300.22" },
        { sourceLineId: "L3", description: "Data transfer", amount: "134.23" },
      ],
    });

    expect(result.reconciled).toBe(true);
    expect(result.reconciledTotal).toBe("1234.5600");
    expect(result.lineItemCount).toBe(3);
  });

  it("a month whose line items do NOT sum to the invoice total is refused, not silently ingested", async () => {
    await expect(
      ingestion.ingestBillingExport({
        providerId: "aws",
        period: "2026-08",
        currency: "USD",
        invoiceTotal: "1000.00",
        lineItems: [{ sourceLineId: "L1", description: "EC2", amount: "999.98" }], // off by 2 cents
      }),
    ).rejects.toThrow(/does not reconcile to the cent/);

    expect(batches).toHaveLength(0);
  });

  it("re-ingesting the same period does NOT double-count — line items are replaced, not appended", async () => {
    await ingestion.ingestBillingExport({
      providerId: "aws",
      period: "2026-08",
      currency: "USD",
      invoiceTotal: "500.00",
      lineItems: [{ sourceLineId: "L1", description: "EC2", amount: "500.00" }],
    });
    expect(lineItems).toHaveLength(1);
    expect(batches).toHaveLength(1);

    // A corrected export for the SAME period arrives — a different total
    // and different line items, but still one batch per (provider, period).
    const result = await ingestion.ingestBillingExport({
      providerId: "aws",
      period: "2026-08",
      currency: "USD",
      invoiceTotal: "520.00",
      lineItems: [
        { sourceLineId: "L1", description: "EC2 (corrected)", amount: "300.00" },
        { sourceLineId: "L2", description: "Late-arriving credit", amount: "220.00" },
      ],
    });

    expect(batches).toHaveLength(1); // still one batch, not two
    expect(lineItems).toHaveLength(2); // OLD line item replaced, not appended
    expect(lineItems.map((li) => li.sourceLineId).sort()).toEqual(["L1", "L2"]);
    expect(result.reconciledTotal).toBe("520.0000");
    expect(batches[0].invoiceTotal).toBe("520.00");
  });

  it("exact-cent precision holds even with amounts that are not exact in binary floating point", async () => {
    // 0.10 + 0.20 famously != 0.30 in IEEE 754 double arithmetic. This
    // proves the BigInt-cents path is genuinely float-free.
    const result = await ingestion.ingestBillingExport({
      providerId: "gcp",
      period: "2026-09",
      currency: "USD",
      invoiceTotal: "0.30",
      lineItems: [
        { sourceLineId: "L1", description: "a", amount: "0.10" },
        { sourceLineId: "L2", description: "b", amount: "0.20" },
      ],
    });
    expect(result.reconciled).toBe(true);
    expect(result.reconciledTotal).toBe("0.3000");
  });
});
