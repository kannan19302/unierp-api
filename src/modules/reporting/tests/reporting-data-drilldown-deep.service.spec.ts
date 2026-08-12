/**
 * E37 exit criterion: "A dashboard tile drills through to the
 * filtered record list that produced it."
 *
 * ReportingDataDrilldownDeepService.executeDrilldown() previously
 * returned the SAME three hardcoded fake rows for every call
 * regardless of the dimension, filter value, or entity requested —
 * clicking any dashboard tile would show identical fabricated numbers
 * no matter what was actually clicked.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@kannan19302/database", () => ({
  prisma: {
    invoice: {
      findMany: vi.fn(),
      count: vi.fn().mockResolvedValue(0),
    },
  },
}));

import { ReportingDataDrilldownDeepService } from "../reporting-data-drilldown-deep.service";
import { ReportingEngineService } from "../reporting-engine.service";
import { prisma } from "@kannan19302/database";

describe("ReportingDataDrilldownDeepService", () => {
  let service: ReportingDataDrilldownDeepService;
  let reportingEngine: ReportingEngineService;

  beforeEach(() => {
    vi.clearAllMocks();
    reportingEngine = new ReportingEngineService();
    service = new ReportingDataDrilldownDeepService(reportingEngine);
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  it("E37: executes a real, filtered query against the drilled-into dimension — not fabricated fixed rows", async () => {
    const realFilteredInvoices = [
      { id: "inv-1", status: "SENT", totalAmount: 500 },
      { id: "inv-2", status: "SENT", totalAmount: 750 },
    ];
    vi.mocked(prisma.invoice.findMany).mockResolvedValue(
      realFilteredInvoices as never,
    );

    const res = await service.executeDrilldown("t1", {
      entity: "invoices",
      dimension: "status",
      filterValue: "SENT",
      metricKey: "totalAmount",
    });

    // The results returned are the ACTUAL filtered records, not the
    // fabricated "EMEA"/"APAC"/"Americas" rows the old implementation
    // returned unconditionally.
    expect(res.results).toEqual(realFilteredInvoices);
    expect(res.recordCount).toBe(2);
    expect(prisma.invoice.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenantId: "t1", status: "SENT" }),
      }),
    );
  });

  it("E37: a different filterValue produces genuinely different results, proving the query is real", async () => {
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([
      { id: "inv-3", status: "PAID", totalAmount: 1200 },
    ] as never);

    const res = await service.executeDrilldown("t1", {
      entity: "invoices",
      dimension: "status",
      filterValue: "PAID",
    });

    expect(res.results).toEqual([
      { id: "inv-3", status: "PAID", totalAmount: 1200 },
    ]);
  });

  it("rejects a drilldown with no source entity instead of returning fabricated data", async () => {
    await expect(
      service.executeDrilldown("t1", {
        entity: "",
        dimension: "REGION",
        filterValue: "EMEA",
      }),
    ).rejects.toThrow(/source entity/i);
  });
});
