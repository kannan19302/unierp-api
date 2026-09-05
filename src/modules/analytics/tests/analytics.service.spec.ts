import { describe, it, expect, vi, beforeEach } from "vitest";
import { AnalyticsService } from "../services/analytics.service";
import { AnalyticsRepository } from "../repositories/analytics.repository";

describe("AnalyticsService", () => {
  let analyticsService: AnalyticsService;
  let analyticsRepo: Partial<AnalyticsRepository>;

  beforeEach(() => {
    analyticsRepo = {
      findDashboards: vi.fn(),
      findDashboardById: vi.fn(),
      createDashboard: vi.fn(),
      updateDashboard: vi.fn(),
      findSimpleReports: vi.fn(),
      findSimpleReportById: vi.fn(),
      findKpis: vi.fn(),
      createKpis: vi.fn(),
      findInvoicesForDrilldown: vi.fn(),
      findInvoicesForInsights: vi.fn(),
      findProductsForInsights: vi.fn(),
      findLowMarginProducts: vi.fn().mockResolvedValue([]),
      findInvoicesForExport: vi.fn(),
      findEmployeesForExport: vi.fn(),
      findProductsForExport: vi.fn(),
      executePivotAggregation: vi.fn(),
      executeVisualQueryScan: vi.fn(),
      getHistoricalMonthlyRevenue: vi.fn(),
      getRecentActivityTelemetry: vi.fn(),
      findPredictiveModels: vi.fn(),
      createPredictiveModel: vi.fn(),
      createForecastRun: vi.fn(),
    };
    analyticsService = new AnalyticsService(analyticsRepo as AnalyticsRepository);
    vi.clearAllMocks();
  });

  it("should fetch dashboards via analyticsRepo", async () => {
    const mockDash = [{ id: "d-1", name: "Sales Dash" }];
    vi.mocked(analyticsRepo.findDashboards!).mockResolvedValue(mockDash as never);

    const res = await analyticsService.getDashboards("tenant-123");
    expect(res).toBeDefined();
    expect(res[0]?.name).toBe("Sales Dash");
    expect(analyticsRepo.findDashboards).toHaveBeenCalledWith("tenant-123");
  });

  it("should fetch reports via analyticsRepo", async () => {
    const mockReports = [{ id: "r-1", name: "Inventory Report" }];
    vi.mocked(analyticsRepo.findSimpleReports!).mockResolvedValue(mockReports as never);

    const res = await analyticsService.getReports("tenant-123");
    expect(res).toBeDefined();
    expect(res[0]?.name).toBe("Inventory Report");
    expect(analyticsRepo.findSimpleReports).toHaveBeenCalledWith("tenant-123");
  });

  it("should fetch KPIs via analyticsRepo", async () => {
    const mockKPIs = [
      { id: "k-1", code: "TOTAL_REVENUE", value: "$10,000", trend: "[]" },
    ];
    vi.mocked(analyticsRepo.findKpis!).mockResolvedValue(mockKPIs as never);

    const res = await analyticsService.getKPIs("tenant-123");
    expect(res).toBeDefined();
    expect(res[0]?.code).toBe("TOTAL_REVENUE");
  });

  it("should enrich KPIs with goal/target and change %", async () => {
    vi.mocked(analyticsRepo.findKpis!).mockResolvedValue([
      {
        id: "k-1",
        code: "TOTAL_REVENUE",
        value: "$10,000",
        unit: "USD",
        trend: "[8,10]",
      },
    ] as never);

    const res = await analyticsService.getKPIs("tenant-123");
    expect(res[0]?.numericValue).toBe(10000);
    expect(res[0]?.target).toBe(12000);
    expect(res[0]?.progressPct).toBe(83);
    expect(res[0]?.changePct).toBe(25);
  });

  it("should drill down into TOTAL_REVENUE invoices", async () => {
    vi.mocked(analyticsRepo.findInvoicesForDrilldown!).mockResolvedValue([
      {
        invoiceNumber: "INV-1",
        totalAmount: 500,
        status: "PAID",
        issueDate: new Date("2026-01-15"),
      },
    ] as never);

    const res = await analyticsService.getKpiDrilldown(
      "tenant-123",
      "TOTAL_REVENUE",
    );
    expect(res.columns).toContain("invoiceNumber");
    expect(res.rows[0]?.totalAmount).toBe(500);
  });

  it("should detect overdue receivables in insights", async () => {
    vi.mocked(analyticsRepo.findInvoicesForInsights!).mockResolvedValue([
      {
        invoiceNumber: "INV-OVERDUE",
        totalAmount: 5000,
        paidAmount: 0,
        status: "SENT",
        issueDate: new Date("2026-01-01"),
        dueDate: new Date("2026-02-01"),
      },
    ] as never);
    vi.mocked(analyticsRepo.findProductsForInsights!).mockResolvedValue([] as never);

    const res = await analyticsService.getInsights("tenant-123");
    expect(res.some((i) => i.id === "overdue-ar")).toBe(true);
  });

  it("should export invoices as CSV", async () => {
    vi.mocked(analyticsRepo.findInvoicesForExport!).mockResolvedValue([
      {
        invoiceNumber: "INV-1",
        status: "PAID",
        issueDate: new Date("2026-01-15"),
        dueDate: new Date("2026-02-15"),
        totalAmount: 1000,
        paidAmount: 1000,
        currency: "USD",
      },
    ] as never);

    const res = await analyticsService.exportDataset("tenant-123", "invoices");
    expect(res.filename).toContain("invoices-export");
    expect(res.content).toContain("invoiceNumber");
    expect(res.content).toContain("INV-1");
    expect(res.rowCount).toBe(1);
  });

  it("should execute dynamic pivot matrix aggregation", async () => {
    vi.mocked(analyticsRepo.findSimpleReportById!).mockResolvedValue({
      id: "rep-1",
      name: "Quarterly Revenue",
    } as never);
    vi.mocked(analyticsRepo.executePivotAggregation!).mockResolvedValue([
      { row: "2026-Q1", column: "PAID", value: 50000, count: 12 },
    ] as never);

    const res = await analyticsService.executePivotQuery("tenant-123", "rep-1", {
      rowFields: ["Quarter"],
      colFields: ["Status"],
      aggregations: ["SUM(totalAmount)"],
    });
    expect(res.pivotData).toHaveLength(1);
    expect(res.pivotData[0]?.row).toBe("2026-Q1");
    expect(res.pivotData[0]?.value).toBe(50000);
  });

  it("should fetch historical monthly revenue via analyticsRepo", async () => {
    const mockMonthly = [
      { month: "2026-01", amount: 45000 },
      { month: "2026-02", amount: 62000 },
    ];
    vi.mocked(analyticsRepo.getHistoricalMonthlyRevenue!).mockResolvedValue(mockMonthly as never);

    const res = await analyticsService.getHistoricalMonthlyRevenue("tenant-123");
    expect(res).toHaveLength(2);
    expect(res[0]?.month).toBe("2026-01");
    expect(res[0]?.amount).toBe(45000);
    expect(analyticsRepo.getHistoricalMonthlyRevenue).toHaveBeenCalledWith("tenant-123");
  });

  it("should fetch recent activity telemetry via analyticsRepo", async () => {
    const mockTelemetry = {
      recentInvoices: [{ id: "inv-1", invoiceNumber: "INV-001", status: "PAID", createdAt: new Date() }],
      activeEmployees: 5,
      recentAuditLogs: [{ id: "aud-1", action: "invoice.create", entityType: "Invoice", createdAt: new Date() }],
    };
    vi.mocked(analyticsRepo.getRecentActivityTelemetry!).mockResolvedValue(mockTelemetry as never);

    const res = await analyticsService.getRecentActivity("tenant-123");
    expect(res.recentInvoices).toHaveLength(1);
    expect(res.activeEmployees).toBe(5);
    expect(res.recentAuditLogs).toHaveLength(1);
    expect(analyticsRepo.getRecentActivityTelemetry).toHaveBeenCalledWith("tenant-123");
  });
});

