/**
 * D21 exit criterion: "A tenant sees the same usage figure the invoice
 * was computed from. A discrepancy is a failing test, not a support
 * ticket."
 *
 * SaasPortalUsageMetricsPortalService.getUsageDashboard() previously
 * read from a completely SEPARATE table (saasPortalUsageDashboard),
 * disconnected from the real UsageRecord table BillingService's own
 * overage/invoice computation (getUsageSummary/computeCurrentCycleCost)
 * actually reads. A tenant's dashboard figure could silently diverge
 * from what their invoice was really computed from. This spec proves
 * the reconciliation directly: the SAME UsageRecord rows drive both.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

let usageRecords: any[];

vi.mock("@kannan19302/database", () => ({
  prisma: {
    usageRecord: {
      findMany: vi.fn(({ where }: any) => usageRecords.filter((r) => r.tenantId === where.tenantId)),
    },
  },
}));

import { SaasPortalUsageMetricsPortalService } from "../saas-portal-usage-metrics-portal.service";

describe("D21 · tenant usage dashboard reconciles exactly with the invoice-computing UsageRecord table", () => {
  let dashboard: SaasPortalUsageMetricsPortalService;

  beforeEach(() => {
    vi.clearAllMocks();
    usageRecords = [
      { id: "ur-1", tenantId: "t1", metric: "API_CALLS_COUNT", currentValue: 45000, limitValue: 50000, updatedAt: new Date() },
      { id: "ur-2", tenantId: "t1", metric: "STORAGE_MB", currentValue: 12000, limitValue: 10000, updatedAt: new Date() }, // over limit — this is what generates overage cost on the invoice
      { id: "ur-3", tenantId: "t2", metric: "API_CALLS_COUNT", currentValue: 100, limitValue: 5000, updatedAt: new Date() },
    ];
    dashboard = new SaasPortalUsageMetricsPortalService();
  });

  it("shows the EXACT SAME currentValue/limitValue the invoice engine reads from UsageRecord — no separate dataset", async () => {
    const result = await dashboard.getUsageDashboard("t1");

    const apiUsage = result.find((r: any) => r.metric === "API_CALLS_COUNT");
    expect(apiUsage.currentValue).toBe(45000); // identical to the UsageRecord row invoicing reads
    expect(apiUsage.limitValue).toBe(50000);

    const storageUsage = result.find((r: any) => r.metric === "STORAGE_MB");
    expect(storageUsage.currentValue).toBe(12000);
    expect(storageUsage.limitValue).toBe(10000);
  });

  it("a metric OVER its limit (the exact condition that generates overage cost on the invoice) is visible to the tenant, not hidden", async () => {
    const result = await dashboard.getUsageDashboard("t1");
    const storageUsage = result.find((r: any) => r.metric === "STORAGE_MB");
    expect(storageUsage.currentValue).toBeGreaterThan(storageUsage.limitValue);
    expect(storageUsage.isOverLimit).toBe(true);
  });

  it("is strictly tenant-scoped — never shows another tenant's usage figures", async () => {
    const result = await dashboard.getUsageDashboard("t1");
    expect(result.every((r: any) => r.tenantId === "t1")).toBe(true);
    expect(result).toHaveLength(2); // exactly t1's own rows, not t2's
  });

  it("a tenant with NO usage records sees an empty dashboard, not a fabricated figure", async () => {
    const result = await dashboard.getUsageDashboard("t3");
    expect(result).toEqual([]);
  });
});
