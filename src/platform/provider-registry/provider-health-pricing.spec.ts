/**
 * M04 exit criterion: "A provider whose probe fails is marked unhealthy
 * within its declared interval and is excluded from routing. Its recorded
 * price and limits are the ones M06 routes on and M25 costs against — not
 * a second copy."
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

let providers: any[];
let healthConfigs: any[];
let healthChecks: any[];
let quotas: any[];
let priceEntries: any[];
let seq = 0;
const nextId = (p: string) => `${p}-${++seq}`;

vi.mock("@kannan19302/database", () => ({
  prisma: {
    provider: {
      create: vi.fn(({ data }: any) => {
        const row = { id: nextId("prov"), status: "ACTIVE", description: null, ...data };
        providers.push(row);
        return row;
      }),
      findUnique: vi.fn(({ where: { id } }: any) => providers.find((p) => p.id === id) ?? null),
      update: vi.fn(({ where: { id }, data }: any) => {
        const row = providers.find((p) => p.id === id)!;
        Object.assign(row, data);
        return row;
      }),
    },
    providerHealthConfig: {
      upsert: vi.fn(({ where: { providerId }, create }: any) => {
        const existing = healthConfigs.find((c) => c.providerId === providerId);
        if (existing) {
          Object.assign(existing, create);
          return existing;
        }
        const row = { id: nextId("hcfg"), ...create };
        healthConfigs.push(row);
        return row;
      }),
      findUnique: vi.fn(({ where: { providerId } }: any) =>
        healthConfigs.find((c) => c.providerId === providerId) ?? null,
      ),
    },
    providerHealthCheck: {
      create: vi.fn(({ data }: any) => {
        // insertionIndex is a mock-only tiebreaker: two checks recorded in
        // the same JS event-loop tick can carry the identical millisecond
        // Date, which real Postgres row storage doesn't collapse the way an
        // in-memory array + Date-only sort would.
        const row = { id: nextId("hchk"), checkedAt: new Date(), insertionIndex: healthChecks.length, ...data };
        healthChecks.push(row);
        return row;
      }),
      findFirst: vi.fn(({ where: { providerId } }: any) => {
        const rows = healthChecks
          .filter((c) => c.providerId === providerId)
          .sort(
            (a, b) =>
              b.checkedAt.getTime() - a.checkedAt.getTime() || b.insertionIndex - a.insertionIndex,
          );
        return rows[0] ?? null;
      }),
    },
    providerQuota: {
      upsert: vi.fn(({ where, create, update }: any) => {
        const key = where.providerId_capabilityId;
        const existing = quotas.find(
          (q) => q.providerId === key.providerId && q.capabilityId === key.capabilityId,
        );
        if (existing) {
          Object.assign(existing, update);
          return existing;
        }
        const row = { id: nextId("quota"), observedAt: new Date(), ...create };
        quotas.push(row);
        return row;
      }),
      findUnique: vi.fn(({ where }: any) => {
        const key = where.providerId_capabilityId;
        return (
          quotas.find(
            (q) => q.providerId === key.providerId && q.capabilityId === key.capabilityId,
          ) ?? null
        );
      }),
    },
    providerPriceSheetEntry: {
      upsert: vi.fn(({ where, create, update }: any) => {
        const key = where.providerId_capabilityId_operation_unit;
        const existing = priceEntries.find(
          (p) =>
            p.providerId === key.providerId &&
            p.capabilityId === key.capabilityId &&
            p.operation === key.operation &&
            p.unit === key.unit,
        );
        if (existing) {
          Object.assign(existing, update);
          return existing;
        }
        const row = { id: nextId("price"), observedAt: new Date(), ...create };
        priceEntries.push(row);
        return row;
      }),
      findUnique: vi.fn(({ where }: any) => {
        const key = where.providerId_capabilityId_operation_unit;
        return (
          priceEntries.find(
            (p) =>
              p.providerId === key.providerId &&
              p.capabilityId === key.capabilityId &&
              p.operation === key.operation &&
              p.unit === key.unit,
          ) ?? null
        );
      }),
      findMany: vi.fn(({ where }: any) => priceEntries.filter((p) => p.providerId === where.providerId)),
    },
  },
}));

vi.mock("@kannan19302/shared", () => ({
  bindProvider: vi.fn(),
  unbindProvider: vi.fn(),
}));

import { ProviderRegistryService } from "./provider-registry.service";

describe("M04 · provider health, limits, quotas and pricing", () => {
  let service: ProviderRegistryService;

  beforeEach(() => {
    vi.clearAllMocks();
    providers = [];
    healthConfigs = [];
    healthChecks = [];
    quotas = [];
    priceEntries = [];
    service = new ProviderRegistryService();
  });

  it("a provider whose probe fails is marked unhealthy and excluded from routing", async () => {
    const p = await service.registerProvider({ name: "Flaky" });
    await service.setHealthCheckInterval(p.id, 30);

    expect(await service.isHealthy(p.id)).toBe(false); // never probed
    await service.recordHealthCheck(p.id, { healthy: true, latencyMs: 40 });
    expect(await service.isHealthy(p.id)).toBe(true);
    expect(await service.isExcludedFromRouting(p.id)).toBe(false);

    await service.recordHealthCheck(p.id, { healthy: false, error: "connection refused" });
    expect(await service.isHealthy(p.id)).toBe(false);
    expect(await service.isExcludedFromRouting(p.id)).toBe(true);
  });

  it("a provider not probed within (2x) its declared interval is treated as unhealthy — staleness, not only explicit failure", async () => {
    const p = await service.registerProvider({ name: "Stale" });
    await service.setHealthCheckInterval(p.id, 1); // 1 second, so we can age it out fast

    const check = await service.recordHealthCheck(p.id, { healthy: true });
    expect(await service.isHealthy(p.id)).toBe(true);

    // Age the check past 2x the declared interval (2s) without a new probe.
    check.checkedAt = new Date(Date.now() - 3000);

    expect(await service.isHealthy(p.id)).toBe(false);
    expect(await service.isExcludedFromRouting(p.id)).toBe(true);
  });

  it("a provider with no declared interval is still evaluated purely on its latest probe result", async () => {
    const p = await service.registerProvider({ name: "NoInterval" });
    await service.recordHealthCheck(p.id, { healthy: true });
    expect(await service.isHealthy(p.id)).toBe(true);
  });

  it("recorded quota is observed data, read back exactly as recorded", async () => {
    const p = await service.registerProvider({ name: "Quota Test" });
    await service.recordQuota(p.id, "email.send", { limitValue: 1000, windowSeconds: 3600 });
    const quota = await service.getQuota(p.id, "email.send");
    expect(quota.limitValue).toBe(1000);
    expect(quota.windowSeconds).toBe(3600);
  });

  it("the recorded price is the single source getPriceFor reads back — no second copy", async () => {
    const p = await service.registerProvider({ name: "Price Test" });
    await service.recordPriceSheetEntry(p.id, {
      capabilityId: "llm.complete",
      operation: "complete",
      unit: "1k_tokens",
      pricePerUnit: "0.0150", // string — never a JS number float
    });

    const price = await service.getPriceFor(p.id, "llm.complete", "complete", "1k_tokens");
    expect(price.pricePerUnit).toBe("0.0150");

    // Re-recording (a price update) replaces the SAME row rather than
    // creating a second entry — proving there is exactly one row this
    // capability+operation+unit combination can ever resolve to.
    await service.recordPriceSheetEntry(p.id, {
      capabilityId: "llm.complete",
      operation: "complete",
      unit: "1k_tokens",
      pricePerUnit: "0.0175",
    });
    const sheet = await service.getPriceSheet(p.id);
    expect(sheet).toHaveLength(1);
    expect(sheet[0].pricePerUnit).toBe("0.0175");
  });
});
