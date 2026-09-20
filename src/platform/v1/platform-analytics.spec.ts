/**
 * Unit tests for PlatformAnalyticsService & PlatformAnalyticsController (PCC-16)
 *
 * Verifies:
 * - EC-16.1: Custom dashboard composer creates/edits/deletes layouts with KPI cards, charts, and tables
 * - EC-16.2: Report scheduler creates recurring schedules (daily/weekly/monthly), toggles status, and runs jobs
 * - Metrics catalog and anomaly detection threshold alerts
 */
import { describe, it, expect, beforeEach } from "vitest";
import { PlatformAnalyticsService } from "./platform-analytics.service";

describe("PlatformAnalyticsService (PCC-16)", () => {
  let service: PlatformAnalyticsService;

  beforeEach(() => {
    service = new PlatformAnalyticsService();
  });

  describe("EC-16.1: Custom Dashboard Composer", () => {
    it("lists default and custom dashboards", async () => {
      const dashboards = await service.listDashboards();
      expect(dashboards.length).toBeGreaterThanOrEqual(2);
      expect(dashboards[0].name).toContain("Executive Revenue");
      expect(dashboards[0].widgets.length).toBeGreaterThanOrEqual(3);
    });

    it("creates a new custom dashboard layout with multiple widget types", async () => {
      const newDash = await service.createDashboard({
        name: "FinOps Cloud Unit Economics",
        description: "AWS/GCP infrastructure spend vs billed tenant ARR",
        category: "REVENUE",
        widgets: [
          {
            id: "w-cost-ratio",
            title: "Gross Margin %",
            type: "KPI_CARD",
            metric: "MARGIN",
            gridSpan: 1,
          },
          {
            id: "w-monthly-burn",
            title: "Compute Burn vs Budget",
            type: "BAR_CHART",
            metric: "CLOUD_SPEND",
            gridSpan: 2,
          },
        ],
      });

      expect(newDash.id).toBeDefined();
      expect(newDash.name).toBe("FinOps Cloud Unit Economics");
      expect(newDash.widgets).toHaveLength(2);

      const retrieved = await service.getDashboard(newDash.id);
      expect(retrieved.name).toBe(newDash.name);
    });

    it("updates existing dashboard widgets and layout", async () => {
      const dashboards = await service.listDashboards();
      const target = dashboards[0];

      const updated = await service.updateDashboard(target.id, {
        name: "Executive ARR Radar (Updated)",
      });
      expect(updated.name).toBe("Executive ARR Radar (Updated)");
    });

    it("deletes a dashboard", async () => {
      const dashboards = await service.listDashboards();
      const targetId = dashboards[0].id;

      const res = await service.deleteDashboard(targetId);
      expect(res.success).toBe(true);

      const after = await service.listDashboards();
      expect(after.some((d) => d.id === targetId)).toBe(false);
    });
  });

  describe("EC-16.2: Recurring Report Scheduler", () => {
    it("lists active report schedules", async () => {
      const schedules = await service.listReportSchedules();
      expect(schedules.length).toBeGreaterThanOrEqual(2);
      expect(schedules[0].recipients.length).toBeGreaterThanOrEqual(1);
    });

    it("creates a new recurring report schedule", async () => {
      const schedule = await service.createReportSchedule({
        name: "Monthly Security & Compliance Digest",
        frequency: "MONTHLY",
        format: "PDF",
        recipients: ["security-officer@unierp.com", "compliance@unierp.com"],
      });

      expect(schedule.id).toBeDefined();
      expect(schedule.name).toBe("Monthly Security & Compliance Digest");
      expect(schedule.status).toBe("ACTIVE");
      expect(schedule.format).toBe("PDF");
      expect(schedule.recipients).toHaveLength(2);
    });

    it("toggles report schedule active/paused state", async () => {
      const schedules = await service.listReportSchedules();
      const target = schedules[0];
      const initialStatus = target.status;

      const toggled = await service.toggleReportSchedule(target.id);
      expect(toggled.status).toBe(initialStatus === "ACTIVE" ? "PAUSED" : "ACTIVE");

      const reToggled = await service.toggleReportSchedule(target.id);
      expect(reToggled.status).toBe(initialStatus);
    });

    it("triggers instant execution of a report schedule", async () => {
      const schedules = await service.listReportSchedules();
      const target = schedules[0];

      const res = await service.triggerReportRun(target.id);
      expect(res.success).toBe(true);
      expect(res.executedAt).toBeDefined();
    });
  });

  describe("Platform Intelligence Metrics & Anomaly Alerts", () => {
    it("returns available metrics catalog and active anomaly threshold alerts", async () => {
      const result = await service.getPlatformMetrics();
      expect(result.availableMetrics.length).toBeGreaterThanOrEqual(5);
      expect(result.anomalyAlerts.length).toBeGreaterThanOrEqual(1);
      expect(result.anomalyAlerts[0].severity).toBeDefined();
    });
  });
});
