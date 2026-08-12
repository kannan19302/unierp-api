/**
 * E42 exit criterion: "Each supported market's mandatory filings are
 * produced and validated against that jurisdiction's specification.
 * Unsupported markets are stated explicitly rather than implied."
 *
 * TaxEngineService.computeTaxReturn() previously accepted ANY string as
 * filingType with zero validation — "GSTR-1", "US-SALES-TAX", or a typo
 * like "XYZ-999" all produced the byte-identical generic
 * output-tax-minus-input-tax aggregate, silently labeled with whatever
 * string was passed. An unsupported market was never stated as
 * unsupported — it was implied to be a real, validated filing.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

let invoices: any[];
let purchaseOrders: any[];
let filings: any[];

vi.mock("@kannan19302/database", () => ({
  prisma: {
    invoice: {
      findMany: vi.fn(() => invoices),
    },
    purchaseOrder: {
      findMany: vi.fn(() => purchaseOrders),
    },
    taxFiling: {
      create: vi.fn(({ data }: any) => {
        const row = { id: `f-${filings.length + 1}`, ...data };
        filings.push(row);
        return row;
      }),
    },
  },
}));

import { TaxEngineService } from "../services/tax-engine.service";

describe("TaxEngineService.computeTaxReturn", () => {
  let service: TaxEngineService;
  let glService: any;

  beforeEach(() => {
    invoices = [
      { id: "i1", taxAmount: 100 },
      { id: "i2", taxAmount: 50 },
    ];
    purchaseOrders = [{ id: "p1", taxAmount: 30 }];
    filings = [];
    glService = { resolveOrgId: vi.fn().mockResolvedValue("org-1") };
    service = new TaxEngineService(glService);
  });

  it("computes a real filing for a supported filing type", async () => {
    const result = await service.computeTaxReturn(
      "t1",
      "org-1",
      "GSTR-1",
      "2026-01-01",
      "2026-01-31",
    );
    expect(result.jurisdiction).toBe("IN");
    expect(result.outputTax).toBe(150);
    expect(result.inputTax).toBe(30);
    expect(result.netTaxPayable).toBe(120);
  });

  it("E42: rejects an unsupported filing type instead of silently computing a generic return", async () => {
    await expect(
      service.computeTaxReturn(
        "t1",
        "org-1",
        "XYZ-999",
        "2026-01-01",
        "2026-01-31",
      ),
    ).rejects.toThrow(/not a supported statutory filing/);
  });

  it("E42: an unsupported filing type never creates a TaxFiling row", async () => {
    await expect(
      service.computeTaxReturn(
        "t1",
        "org-1",
        "MADE-UP-FILING",
        "2026-01-01",
        "2026-01-31",
      ),
    ).rejects.toThrow();
    expect(filings).toHaveLength(0);
  });
});
