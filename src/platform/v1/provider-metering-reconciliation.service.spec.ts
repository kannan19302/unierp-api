/**
 * M30 exit criterion: "A deliberate divergence between provider
 * consumption and metered quantity is detected and reported with both
 * sources named. Extends C14's reconciliation view; does not fork it."
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

let events: any[];
let reports: any[];
let seq = 0;
const nextId = (p: string) => `${p}-${++seq}`;

vi.mock("@kannan19302/database", () => ({
  prisma: {
    meteringEvent: {
      findMany: vi.fn(({ where }: any) =>
        events.filter(
          (e) =>
            e.tenantId === where.tenantId &&
            e.metric === where.metric &&
            new Date(e.timestamp) >= where.timestamp.gte &&
            new Date(e.timestamp) < where.timestamp.lt,
        ),
      ),
    },
    providerConsumptionReport: {
      upsert: vi.fn(({ where, create, update }: any) => {
        const k = where.providerId_tenantId_metric_period;
        const existing = reports.find(
          (r) => r.providerId === k.providerId && r.tenantId === k.tenantId && r.metric === k.metric && r.period === k.period,
        );
        if (existing) {
          Object.assign(existing, update);
          return existing;
        }
        const row = { id: nextId("report"), reportedAt: new Date(), ...create };
        reports.push(row);
        return row;
      }),
      findUnique: vi.fn(({ where }: any) => {
        const k = where.providerId_tenantId_metric_period;
        return (
          reports.find((r) => r.providerId === k.providerId && r.tenantId === k.tenantId && r.metric === k.metric && r.period === k.period) ??
          null
        );
      }),
    },
  },
}));

import { ProviderMeteringReconciliationService } from "./provider-metering-reconciliation.service";

describe("M30 · metering reconciliation, provider vs invoiced", () => {
  let recon: ProviderMeteringReconciliationService;

  beforeEach(() => {
    vi.clearAllMocks();
    events = [];
    reports = [];
    recon = new ProviderMeteringReconciliationService();
  });

  it("a deliberate divergence between provider consumption and metered quantity is detected, both sources named", async () => {
    // C14's own metering events: 3 API calls this period.
    events.push(
      { id: "ev-1", tenantId: "tenant-1", metric: "API_CALLS_COUNT", quantity: 100, timestamp: new Date("2026-08-05") },
      { id: "ev-2", tenantId: "tenant-1", metric: "API_CALLS_COUNT", quantity: 50, timestamp: new Date("2026-08-10") },
    );
    // Provider's OWN report claims a different number -- a deliberate divergence.
    await recon.recordProviderConsumption("aws", "tenant-1", "API_CALLS_COUNT", "2026-08", 200);

    const report = await recon.reconcile("aws", "tenant-1", "API_CALLS_COUNT", "2026-08");

    expect(report.diverged).toBe(true);
    expect(report.variance).toBe(-50); // 150 metered - 200 provider
    // Both sources named explicitly, with drill-down.
    expect(report.meteredSource).toBe("C14 metering events");
    expect(report.meteredQuantity).toBe(150);
    expect(report.meteredEventIds.sort()).toEqual(["ev-1", "ev-2"]);
    expect(report.providerSource).toBe("aws");
    expect(report.providerQuantity).toBe(200);
    expect(report.providerReportId).not.toBeNull();
  });

  it("matching quantities report no divergence", async () => {
    events.push({ id: "ev-1", tenantId: "tenant-2", metric: "STORAGE_MB", quantity: 500, timestamp: new Date("2026-08-05") });
    await recon.recordProviderConsumption("gcp", "tenant-2", "STORAGE_MB", "2026-08", 500);

    const report = await recon.reconcile("gcp", "tenant-2", "STORAGE_MB", "2026-08");
    expect(report.diverged).toBe(false);
    expect(report.variance).toBe(0);
  });

  it("a provider with no report at all is treated as reporting 0, not silently skipped", async () => {
    events.push({ id: "ev-1", tenantId: "tenant-3", metric: "USERS_COUNT", quantity: 10, timestamp: new Date("2026-08-05") });

    const report = await recon.reconcile("azure", "tenant-3", "USERS_COUNT", "2026-08");
    expect(report.providerQuantity).toBe(0);
    expect(report.providerReportId).toBeNull();
    expect(report.diverged).toBe(true);
    expect(report.variance).toBe(10);
  });

  it("only reads events within the requested period, not the tenant's entire history", async () => {
    events.push(
      { id: "ev-in", tenantId: "tenant-4", metric: "API_CALLS_COUNT", quantity: 10, timestamp: new Date("2026-08-15") },
      { id: "ev-out-before", tenantId: "tenant-4", metric: "API_CALLS_COUNT", quantity: 999, timestamp: new Date("2026-07-31") },
      { id: "ev-out-after", tenantId: "tenant-4", metric: "API_CALLS_COUNT", quantity: 999, timestamp: new Date("2026-09-01") },
    );
    await recon.recordProviderConsumption("aws", "tenant-4", "API_CALLS_COUNT", "2026-08", 10);

    const report = await recon.reconcile("aws", "tenant-4", "API_CALLS_COUNT", "2026-08");
    expect(report.meteredQuantity).toBe(10);
    expect(report.meteredEventIds).toEqual(["ev-in"]);
    expect(report.diverged).toBe(false);
  });
});
