/**
 * @file analytics.controller.spec.ts
 * @description Unit tests for AnalyticsController validating contract integration,
 * schema enforcement, and service delegation.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { AnalyticsController } from "../controllers/analytics.controller";
import { AnalyticsService } from "../services/analytics.service";
import {
  createDashboardSchema,
  updateDashboardSchema,
  createReportSchema,
  executePivotQueryRequestSchema,
  executeVisualQueryRequestSchema,
} from "@kannan19302/contracts";

describe("AnalyticsController Contract Consumer Proof", () => {
  let controller: AnalyticsController;
  let service: Partial<AnalyticsService>;

  const mockReq = {
    user: {
      tenantId: "tenant_test_123",
      userId: "usr_analyst_1",
      email: "analyst@meridian.com",
      roles: ["Analyst"],
      orgId: "org_finance_1",
    },
  } as any;

  beforeEach(() => {
    service = {
      getDashboards: vi.fn().mockResolvedValue([]),
      getDashboardById: vi.fn().mockResolvedValue({ id: "dash_1", name: "Executive" }),
      createDashboard: vi.fn().mockResolvedValue({ id: "dash_new", name: "New Dash" }),
      updateDashboard: vi.fn().mockResolvedValue({ id: "dash_1", name: "Updated Dash" }),
      deleteDashboard: vi.fn().mockResolvedValue({ success: true }),
      getReports: vi.fn().mockResolvedValue([]),
      createReport: vi.fn().mockResolvedValue({ id: "rep_new", name: "New Report" }),
      deleteReport: vi.fn().mockResolvedValue({ success: true }),
      getKPIs: vi.fn().mockResolvedValue([]),
      getKpiDrilldown: vi.fn().mockResolvedValue({ code: "TOTAL_REVENUE", rows: [] }),
      getInsights: vi.fn().mockResolvedValue([]),
      exportDataset: vi.fn().mockResolvedValue({ filename: "export.csv" }),
      getHistoricalMonthlyRevenue: vi.fn().mockResolvedValue([]),
      getRecentActivity: vi.fn().mockResolvedValue([]),
      executePivotQuery: vi.fn().mockResolvedValue({ reportId: "rep_1", pivotData: [] }),
      runSecureVisualQuery: vi.fn().mockResolvedValue({ success: true, fields: [], rows: [] }),
    };

    controller = new AnalyticsController(service as AnalyticsService);
  });

  describe("Create & Update Dashboard Contracts", () => {
    it("delegates valid createDashboard payload to service", async () => {
      const validPayload = createDashboardSchema.parse({
        name: "Financial Operations",
        description: "Core financial metrics",
        layout: [
          {
            id: "w_rev",
            title: "Revenue",
            chartType: "METRIC_CARD",
            source: "invoices",
            width: 4,
            height: 3,
          },
        ],
      });

      const res = await controller.createDashboard(mockReq, validPayload);
      expect(res).toBeDefined();
      expect(service.createDashboard).toHaveBeenCalledWith(
        "tenant_test_123",
        "org_finance_1",
        validPayload
      );
    });

    it("delegates valid updateDashboard payload with optimistic locking to service", async () => {
      const validUpdate = updateDashboardSchema.parse({
        name: "Updated Executive View",
        expectedVersion: 2,
      });

      const res = await controller.updateDashboard(mockReq, "dash_1", validUpdate);
      expect(res).toBeDefined();
      expect(service.updateDashboard).toHaveBeenCalledWith(
        "tenant_test_123",
        "dash_1",
        validUpdate
      );
    });

    it("enforces validation: rejects dashboard widget exceeding 12 grid columns", () => {
      expect(() =>
        createDashboardSchema.parse({
          name: "Invalid Grid",
          layout: [
            {
              id: "w_wide",
              title: "Overflown",
              chartType: "BAR",
              source: "orders",
              width: 13,
            },
          ],
        })
      ).toThrow();
    });
  });

  describe("Reports & Query Execution Contracts", () => {
    it("delegates valid createReport payload to service", async () => {
      const validReport = createReportSchema.parse({
        name: "Monthly Headcount",
        type: "BUILDER",
        parameters: [
          {
            id: "p_dept",
            name: "department",
            label: "Department",
            type: "SELECT",
          },
        ],
      });

      const res = await controller.createReport(mockReq, validReport);
      expect(res).toBeDefined();
      expect(service.createReport).toHaveBeenCalledWith(
        "tenant_test_123",
        "org_finance_1",
        validReport
      );
    });

    it("delegates valid executePivotQuery payload to service", async () => {
      const validPivot = executePivotQueryRequestSchema.parse({
        rowFields: ["region"],
        colFields: ["quarter"],
        aggregations: [{ field: "amount", fn: "SUM" }],
      });

      const res = await controller.executePivotQuery(mockReq, "rep_1", validPivot);
      expect(res).toBeDefined();
      expect(service.executePivotQuery).toHaveBeenCalledWith(
        "tenant_test_123",
        "rep_1",
        validPivot
      );
    });

    it("delegates valid runSecureVisualQuery payload to service", async () => {
      const validQuery = executeVisualQueryRequestSchema.parse({
        selectFields: ["invoiceNumber", "totalAmount"],
        limit: 50,
      });

      const res = await controller.runSecureVisualQuery(mockReq, validQuery);
      expect(res).toBeDefined();
      expect(service.runSecureVisualQuery).toHaveBeenCalledWith(
        "tenant_test_123",
        validQuery
      );
    });
  });
});
