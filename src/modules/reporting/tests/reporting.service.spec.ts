import { describe, it, expect, vi, beforeEach } from "vitest";
import { ReportingService } from "../reporting.service";
import { ReportingEngineService } from "../reporting-engine.service";

vi.mock("@kannan19302/database", () => {
  return {
    prisma: {
      reportWidget: {
        findMany: vi.fn(),
        create: vi.fn(),
      },
      reportView: {
        findMany: vi.fn(),
        create: vi.fn(),
      },
      report: {
        findFirst: vi.fn(),
        findMany: vi.fn(),
        create: vi.fn(),
        delete: vi.fn(),
      },
    },
  };
});

describe("ReportingService", () => {
  let service: ReportingService;
  let reportingEngine: ReportingEngineService;

  beforeEach(() => {
    reportingEngine = new ReportingEngineService();
    service = new ReportingService(reportingEngine);
    vi.clearAllMocks();
  });

  it("should get report widgets", async () => {
    const { prisma } = await import("@kannan19302/database");
    const mockWidgets = [
      { id: "w-1", title: "Sales Report", chartType: "BAR" },
    ];
    vi.mocked(prisma.reportWidget.findMany).mockResolvedValue(
      mockWidgets as never,
    );

    const res = await service.getWidgets("tenant-123");
    expect(res).toBeDefined();
    expect(res[0]?.title).toBe("Sales Report");
  });

  describe("runReport — E35: respects the VIEWER's permissions, not the author's", () => {
    it("REFUSES to run a saved report against a permission-gated entity for a viewer without the required permission", async () => {
      const { prisma } = await import("@kannan19302/database");
      vi.mocked(prisma.report.findFirst).mockResolvedValue({
        id: "rpt-1",
        tenantId: "t1",
        name: "Headcount by department",
        query: { entity: "employees" },
        createdBy: "author-user",
      } as never);

      await expect(
        service.runReport("t1", "rpt-1", ["reporting.read"]), // lacks hr.employee.read
      ).rejects.toThrow(/permission/i);
    });

    it("runs a saved report for a viewer who DOES hold the required permission, even though they did not author it", async () => {
      const { prisma } = await import("@kannan19302/database");
      vi.mocked(prisma.report.findFirst).mockResolvedValue({
        id: "rpt-1",
        tenantId: "t1",
        name: "Headcount by department",
        query: { entity: "employees" },
        createdBy: "author-user",
      } as never);
      const executeQuerySpy = vi
        .spyOn(reportingEngine, "executeQuery")
        .mockResolvedValue({ data: [{ count: 12 }] } as never);

      const result = await service.runReport("t1", "rpt-1", [
        "reporting.read",
        "hr.employee.read",
      ]);

      expect(executeQuerySpy).toHaveBeenCalledWith(
        "t1",
        "employees",
        expect.anything(),
      );
      expect(result.data).toEqual([{ count: 12 }]);
    });

    it("does not require any special permission to run a report against a non-gated entity", async () => {
      const { prisma } = await import("@kannan19302/database");
      vi.mocked(prisma.report.findFirst).mockResolvedValue({
        id: "rpt-2",
        tenantId: "t1",
        name: "Overdue invoices",
        query: { entity: "invoices" },
        createdBy: "author-user",
      } as never);
      vi.spyOn(reportingEngine, "executeQuery").mockResolvedValue({
        data: [{ count: 5 }],
      } as never);

      const result = await service.runReport("t1", "rpt-2", [
        "reporting.read",
      ]);

      expect(result.data).toEqual([{ count: 5 }]);
    });
  });
});
