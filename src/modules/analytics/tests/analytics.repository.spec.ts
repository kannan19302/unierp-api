import { describe, it, expect, vi, beforeEach } from "vitest";
import { AnalyticsRepository } from "../repositories/analytics.repository";

vi.mock("@kannan19302/database", () => {
  return {
    prisma: {
      dashboard: {
        findMany: vi.fn(),
        findFirst: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      report: {
        findMany: vi.fn(),
        findFirst: vi.fn(),
        create: vi.fn(),
      },
      reportDefinition: {
        findMany: vi.fn(),
        findFirst: vi.fn(),
        count: vi.fn(),
      },
      kPI: {
        findMany: vi.fn(),
        createMany: vi.fn(),
      },
      invoice: {
        aggregate: vi.fn(),
        findMany: vi.fn(),
      },
      employee: {
        count: vi.fn(),
        findMany: vi.fn(),
      },
      product: {
        count: vi.fn(),
        findMany: vi.fn(),
      },
      auditLog: {
        findMany: vi.fn(),
      },
      analyticsPredictiveModel: {
        findMany: vi.fn(),
        create: vi.fn(),
      },
      analyticsForecastRun: {
        create: vi.fn(),
      },
    },
  };
});

import { prisma } from "@kannan19302/database";

describe("AnalyticsRepository", () => {
  let repository: AnalyticsRepository;

  beforeEach(() => {
    repository = new AnalyticsRepository();
    vi.clearAllMocks();
  });

  describe("Dashboards Isolation", () => {
    it("should query dashboards scoped strictly by tenantId", async () => {
      const mockDashboards = [
        { id: "dash-1", tenantId: "tenant-alpha", name: "Alpha Executive View" },
      ];
      vi.mocked(prisma.dashboard.findMany).mockResolvedValue(mockDashboards as never);

      const result = await repository.findDashboards("tenant-alpha");

      expect(prisma.dashboard.findMany).toHaveBeenCalledWith({
        where: { tenantId: "tenant-alpha" },
        orderBy: { createdAt: "desc" },
      });
      expect(result).toHaveLength(1);
      expect(result[0]?.name).toBe("Alpha Executive View");
    });

    it("should prevent cross-tenant lookup on findDashboardById", async () => {
      vi.mocked(prisma.dashboard.findFirst).mockResolvedValue(null);

      const result = await repository.findDashboardById("tenant-alpha", "dash-foreign");

      expect(prisma.dashboard.findFirst).toHaveBeenCalledWith({
        where: { id: "dash-foreign", tenantId: "tenant-alpha" },
      });
      expect(result).toBeNull();
    });
  });

  describe("Historical Monthly Revenue", () => {
    it("should aggregate invoices into sorted monthly buckets", async () => {
      vi.mocked(prisma.invoice.findMany).mockResolvedValue([
        { totalAmount: 150, issueDate: new Date("2026-01-10T10:00:00Z") },
        { totalAmount: 250, issueDate: new Date("2026-01-20T10:00:00Z") },
        { totalAmount: 500, issueDate: new Date("2026-02-05T10:00:00Z") },
      ] as never);

      const history = await repository.getHistoricalMonthlyRevenue("tenant-alpha");

      expect(prisma.invoice.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenantId: "tenant-alpha" },
        }),
      );
      expect(history).toEqual([
        { month: "2026-01", amount: 400 },
        { month: "2026-02", amount: 500 },
      ]);
    });
  });

  describe("Pivot Matrix Aggregation", () => {
    it("should return empty array truthfully when no invoices exist", async () => {
      vi.mocked(prisma.invoice.findMany).mockResolvedValue([]);

      const result = await repository.executePivotAggregation("tenant-alpha");

      expect(result).toEqual([]);
    });

    it("should aggregate matrix across Quarter and Status", async () => {
      vi.mocked(prisma.invoice.findMany).mockResolvedValue([
        {
          id: "inv-1",
          totalAmount: 1000,
          status: "PAID",
          issueDate: new Date("2026-01-15T00:00:00Z"),
        },
        {
          id: "inv-2",
          totalAmount: 2000,
          status: "PAID",
          issueDate: new Date("2026-02-15T00:00:00Z"),
        },
        {
          id: "inv-3",
          totalAmount: 500,
          status: "PENDING",
          issueDate: new Date("2026-02-20T00:00:00Z"),
        },
      ] as never);

      const result = await repository.executePivotAggregation(
        "tenant-alpha",
        "Quarter",
        "Status",
        "SUM(totalAmount)",
      );

      expect(result).toHaveLength(2);
      const paid = result.find((r) => r.column === "PAID");
      expect(paid?.value).toBe(3000);
      expect(paid?.count).toBe(2);

      const pending = result.find((r) => r.column === "PENDING");
      expect(pending?.value).toBe(500);
      expect(pending?.count).toBe(1);
    });
  });
});
