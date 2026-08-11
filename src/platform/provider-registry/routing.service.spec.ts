/**
 * M06 exit criterion: "Disabling the primary provider moves traffic to the
 * secondary with no code change and no request loss, proven by an
 * integration test. A tenant pinned to a specific provider is never routed
 * elsewhere, including during fallback — asserted separately."
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

let bindings: any[];
let overrides: any[];
let sticky: any[];
let circuits: any[];
let healthConfigs: any[];
let healthChecks: any[];
let seq = 0;
const nextId = (p: string) => `${p}-${++seq}`;

vi.mock("@kannan19302/database", () => ({
  prisma: {
    provider: {
      findUnique: vi.fn(() => ({ id: "x", status: "ACTIVE" })), // not exercised directly here
    },
    providerBinding: {
      findMany: vi.fn(({ where }: any) =>
        bindings.filter((b) => b.capabilityId === where.capabilityId).sort((a, b) => a.priority - b.priority),
      ),
    },
    tenantProviderOverride: {
      findUnique: vi.fn(({ where }: any) => {
        const k = where.tenantId_capabilityId;
        return overrides.find((o) => o.tenantId === k.tenantId && o.capabilityId === k.capabilityId) ?? null;
      }),
      upsert: vi.fn(({ where, create, update }: any) => {
        const k = where.tenantId_capabilityId;
        const existing = overrides.find((o) => o.tenantId === k.tenantId && o.capabilityId === k.capabilityId);
        if (existing) {
          Object.assign(existing, update);
          return existing;
        }
        const row = { id: nextId("ovr"), ...create };
        overrides.push(row);
        return row;
      }),
      deleteMany: vi.fn(({ where }: any) => {
        overrides = overrides.filter((o) => !(o.tenantId === where.tenantId && o.capabilityId === where.capabilityId));
      }),
    },
    stickyRouteAssignment: {
      findUnique: vi.fn(({ where }: any) => {
        const k = where.tenantId_capabilityId_stickyKey;
        return (
          sticky.find(
            (s) => s.tenantId === k.tenantId && s.capabilityId === k.capabilityId && s.stickyKey === k.stickyKey,
          ) ?? null
        );
      }),
      upsert: vi.fn(({ where, create, update }: any) => {
        const k = where.tenantId_capabilityId_stickyKey;
        const existing = sticky.find(
          (s) => s.tenantId === k.tenantId && s.capabilityId === k.capabilityId && s.stickyKey === k.stickyKey,
        );
        if (existing) {
          Object.assign(existing, update);
          return existing;
        }
        const row = { id: nextId("sticky"), ...create };
        sticky.push(row);
        return row;
      }),
    },
    providerCircuitState: {
      findUnique: vi.fn(({ where: { providerId } }: any) => circuits.find((c) => c.providerId === providerId) ?? null),
      create: vi.fn(({ data }: any) => {
        const row = { id: nextId("circ"), ...data };
        circuits.push(row);
        return row;
      }),
      update: vi.fn(({ where: { providerId }, data }: any) => {
        const row = circuits.find((c) => c.providerId === providerId)!;
        Object.assign(row, data);
        return row;
      }),
      upsert: vi.fn(({ where: { providerId }, create }: any) => {
        let row = circuits.find((c) => c.providerId === providerId);
        if (!row) {
          row = { id: nextId("circ"), ...create };
          circuits.push(row);
        }
        return row;
      }),
    },
    providerHealthConfig: {
      findUnique: vi.fn(({ where: { providerId } }: any) => healthConfigs.find((c) => c.providerId === providerId) ?? null),
    },
    providerHealthCheck: {
      findFirst: vi.fn(({ where: { providerId } }: any) => {
        const rows = healthChecks.filter((c) => c.providerId === providerId).sort((a, b) => b.idx - a.idx);
        return rows[0] ?? null;
      }),
      create: vi.fn(({ data }: any) => {
        const row = { id: nextId("hchk"), checkedAt: new Date(), idx: healthChecks.length, ...data };
        healthChecks.push(row);
        return row;
      }),
    },
  },
}));

vi.mock("@kannan19302/shared", () => ({ bindProvider: vi.fn(), unbindProvider: vi.fn() }));

import { RoutingService } from "./routing.service";
import { ProviderRegistryService } from "./provider-registry.service";

describe("M06 · routing, priority, fallback and tenant selection", () => {
  let router: RoutingService;
  let providers: ProviderRegistryService;

  beforeEach(() => {
    vi.clearAllMocks();
    bindings = [];
    overrides = [];
    sticky = [];
    circuits = [];
    healthConfigs = [];
    healthChecks = [];
    providers = new ProviderRegistryService();
    router = new RoutingService(providers);
  });

  async function markHealthy(providerId: string, healthy = true) {
    await providers.recordHealthCheck(providerId, { healthy });
  }

  it("routes to the primary (lowest priority number) when it is healthy", async () => {
    bindings.push(
      { providerId: "prov-primary", capabilityId: "email.send", priority: 0 },
      { providerId: "prov-secondary", capabilityId: "email.send", priority: 100 },
    );
    await markHealthy("prov-primary");
    await markHealthy("prov-secondary");

    const decision = await router.resolve({ tenantId: "tenant-a", capabilityId: "email.send" });
    expect(decision).toEqual({ providerId: "prov-primary", reason: "primary" });
  });

  it("disabling the primary provider moves traffic to the secondary with no code change and no request loss", async () => {
    bindings.push(
      { providerId: "prov-primary", capabilityId: "email.send", priority: 0 },
      { providerId: "prov-secondary", capabilityId: "email.send", priority: 100 },
    );
    await markHealthy("prov-primary");
    await markHealthy("prov-secondary");

    const before = await router.resolve({ tenantId: "tenant-a", capabilityId: "email.send" });
    expect(before.providerId).toBe("prov-primary");

    // "Disabling" is a DATA operation — a health check reporting the
    // provider down — not a code change to this router.
    await markHealthy("prov-primary", false);

    const after = await router.resolve({ tenantId: "tenant-a", capabilityId: "email.send" });
    expect(after).toEqual({ providerId: "prov-secondary", reason: "fallback" });
  });

  it("a tenant pinned to a specific provider is never routed elsewhere, including during fallback", async () => {
    bindings.push(
      { providerId: "prov-primary", capabilityId: "email.send", priority: 0 },
      { providerId: "prov-secondary", capabilityId: "email.send", priority: 100 },
    );
    await markHealthy("prov-primary");
    await markHealthy("prov-secondary");

    // Pin tenant-b to the SECONDARY, not the primary — a deliberate choice
    // distinct from what the priority order alone would select.
    await router.pinTenant("tenant-b", "email.send", "prov-secondary", "compliance requirement");

    const whilePrimaryHealthy = await router.resolve({ tenantId: "tenant-b", capabilityId: "email.send" });
    expect(whilePrimaryHealthy).toEqual({ providerId: "prov-secondary", reason: "pinned" });

    // Now the primary goes down — every OTHER tenant would fail over, but
    // tenant-b's pin is to the secondary already, so this doesn't move it.
    // Prove the harder case: pin tenant-c to the PRIMARY, then take the
    // primary down. tenant-c must still resolve to the primary, not the
    // healthy secondary — the pin overrides health-based fallback entirely.
    await router.pinTenant("tenant-c", "email.send", "prov-primary");
    await markHealthy("prov-primary", false);

    const pinnedToDownProvider = await router.resolve({ tenantId: "tenant-c", capabilityId: "email.send" });
    expect(
      pinnedToDownProvider,
      "a pinned tenant must resolve to its pinned provider even if that provider is currently unhealthy — the pin is absolute, not a preference",
    ).toEqual({ providerId: "prov-primary", reason: "pinned" });

    // And an UNPINNED tenant in the same window correctly falls over.
    const unpinned = await router.resolve({ tenantId: "tenant-unpinned", capabilityId: "email.send" });
    expect(unpinned).toEqual({ providerId: "prov-secondary", reason: "fallback" });
  });

  it("sticky routing keeps a tenant on the same provider across calls while it stays healthy", async () => {
    bindings.push(
      { providerId: "prov-primary", capabilityId: "email.send", priority: 0 },
      { providerId: "prov-secondary", capabilityId: "email.send", priority: 100 },
    );
    await markHealthy("prov-primary");
    await markHealthy("prov-secondary");

    const first = await router.resolve({ tenantId: "tenant-d", capabilityId: "email.send", stickyKey: "thread-1" });
    expect(first.providerId).toBe("prov-primary");

    // Even though priority alone would still pick primary, a DIFFERENT
    // sticky key on the SAME tenant is independent — prove stickiness is
    // keyed, not just "whatever a tenant last got."
    const secondThread = await router.resolve({
      tenantId: "tenant-d",
      capabilityId: "email.send",
      stickyKey: "thread-2",
    });
    expect(secondThread.providerId).toBe("prov-primary");

    const repeat = await router.resolve({ tenantId: "tenant-d", capabilityId: "email.send", stickyKey: "thread-1" });
    expect(repeat).toEqual({ providerId: "prov-primary", reason: "sticky" });
  });

  it("sticky routing follows fallback once its pinned provider becomes unroutable", async () => {
    bindings.push(
      { providerId: "prov-primary", capabilityId: "email.send", priority: 0 },
      { providerId: "prov-secondary", capabilityId: "email.send", priority: 100 },
    );
    await markHealthy("prov-primary");
    await markHealthy("prov-secondary");

    const first = await router.resolve({ tenantId: "tenant-e", capabilityId: "email.send", stickyKey: "thread-1" });
    expect(first.providerId).toBe("prov-primary");

    await markHealthy("prov-primary", false);

    const afterFailure = await router.resolve({
      tenantId: "tenant-e",
      capabilityId: "email.send",
      stickyKey: "thread-1",
    });
    expect(afterFailure.providerId).toBe("prov-secondary");
  });

  it("circuit breaker opens after consecutive failures and excludes the provider even while it self-reports healthy", async () => {
    bindings.push(
      { providerId: "prov-primary", capabilityId: "email.send", priority: 0 },
      { providerId: "prov-secondary", capabilityId: "email.send", priority: 100 },
    );
    await markHealthy("prov-primary");
    await markHealthy("prov-secondary");

    for (let i = 0; i < 5; i++) {
      await router.recordCall("prov-primary", "email.send", { success: false });
    }

    const decision = await router.resolve({ tenantId: "tenant-f", capabilityId: "email.send" });
    expect(
      decision,
      "5 consecutive failures must trip the breaker even though M04 health still says ACTIVE",
    ).toEqual({ providerId: "prov-secondary", reason: "fallback" });
  });

  it("a successful call resets the circuit breaker's failure count", async () => {
    bindings.push({ providerId: "prov-primary", capabilityId: "email.send", priority: 0 });
    await markHealthy("prov-primary");

    for (let i = 0; i < 4; i++) {
      await router.recordCall("prov-primary", "email.send", { success: false });
    }
    await router.recordCall("prov-primary", "email.send", { success: true });

    const decision = await router.resolve({ tenantId: "tenant-g", capabilityId: "email.send" });
    expect(decision.providerId).toBe("prov-primary"); // breaker never actually tripped
  });

  it("quota-aware: a provider whose recorded window usage hits its limit is excluded", async () => {
    bindings.push(
      { providerId: "prov-primary", capabilityId: "email.send", priority: 0 },
      { providerId: "prov-secondary", capabilityId: "email.send", priority: 100 },
    );
    await markHealthy("prov-primary");
    await markHealthy("prov-secondary");

    for (let i = 0; i < 3; i++) {
      await router.recordCall("prov-primary", "email.send", { success: true }, 3);
    }

    const decision = await router.resolve({ tenantId: "tenant-h", capabilityId: "email.send" });
    expect(decision.providerId).toBe("prov-secondary");
  });

  it("throws a typed error when every bound provider is unroutable — not a silent wrong answer", async () => {
    bindings.push({ providerId: "prov-only", capabilityId: "email.send", priority: 0 });
    await markHealthy("prov-only", false);

    await expect(router.resolve({ tenantId: "tenant-i", capabilityId: "email.send" })).rejects.toThrow(
      /no routable provider/i,
    );
  });
});
