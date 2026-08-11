/**
 * M42 exit criterion: "A notification falls back to the secondary
 * provider when the primary fails, without duplicate delivery —
 * asserted."
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

let providers: any[];
let bindings: any[];
let credentials: any[];
let capabilityRows: any[];
let overrides: any[];
let circuitStates: any[];
let usageRows: any[];
let healthChecks: any[];
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
    },
    providerBinding: {
      upsert: vi.fn(({ create }: any) => {
        const exists = bindings.some((b) => b.providerId === create.providerId && b.capabilityId === create.capabilityId);
        if (!exists) bindings.push({ providerId: create.providerId, capabilityId: create.capabilityId, priority: 100 });
        return create;
      }),
      findMany: vi.fn(({ where, orderBy }: any) => {
        let rows = bindings.filter((b) => b.capabilityId === where.capabilityId);
        if (orderBy?.priority === "asc") rows = [...rows].sort((a, b) => a.priority - b.priority);
        return rows;
      }),
    },
    providerCredential: { create: vi.fn(({ data }: any) => { const row = { id: nextId("cred"), ...data }; credentials.push(row); return row; }) },
    providerCapability: {
      upsert: vi.fn(({ create }: any) => { const row = { id: nextId("cap"), discoveredAt: new Date(), ...create }; capabilityRows.push(row); return row; }),
    },
    tenantProviderOverride: { findUnique: vi.fn(({ where }: any) => overrides.find((o) => o.tenantId === where.tenantId_capabilityId.tenantId && o.capabilityId === where.tenantId_capabilityId.capabilityId) ?? null) },
    stickyRouteAssignment: { findUnique: vi.fn(() => null) },
    providerCircuitState: {
      findUnique: vi.fn(({ where: { providerId } }: any) => circuitStates.find((c) => c.providerId === providerId) ?? null),
      update: vi.fn(({ where: { providerId }, data }: any) => {
        const row = circuitStates.find((c) => c.providerId === providerId)!;
        Object.assign(row, data);
        return row;
      }),
      create: vi.fn(({ data }: any) => { circuitStates.push(data); return data; }),
    },
    providerHealthConfig: { findUnique: vi.fn(() => null) },
    providerHealthCheck: {
      findFirst: vi.fn(({ where }: any) => healthChecks.filter((h) => h.providerId === where.providerId).sort((a, b) => b.checkedAt - a.checkedAt)[0] ?? null),
      create: vi.fn(({ data }: any) => { const row = { id: nextId("hc"), checkedAt: new Date(), ...data }; healthChecks.push(row); return row; }),
    },
  },
}));
vi.mock("@kannan19302/shared", () => ({ bindProvider: vi.fn(), unbindProvider: vi.fn() }));

import { ProviderRegistryService } from "../provider-registry/provider-registry.service";
import { RoutingService } from "../provider-registry/routing.service";
import { NotificationRoutingService, EMAIL_CAPABILITY } from "./notification-routing.service";
import type { CapabilityAdapter, ExecutionResult, HealthProbeResult } from "../provider-registry/adapter-contract";
import type { DiscoveredCapability } from "../provider-registry/provider-adapter.interface";

class TestEmailAdapter implements CapabilityAdapter {
  readonly capabilityId = EMAIL_CAPABILITY;
  sent: Array<Record<string, unknown>> = [];
  constructor(public readonly providerId: string, private readonly shouldFail: boolean = false) {}
  async discover(): Promise<DiscoveredCapability[]> { return []; }
  async checkHealth(): Promise<HealthProbeResult> { return { healthy: true }; }
  async execute(input: Record<string, unknown>): Promise<ExecutionResult> {
    if (this.shouldFail) return { success: false, error: "simulated SMTP failure" };
    this.sent.push(input);
    return { success: true, output: { messageId: `msg-${this.sent.length}` } };
  }
}

describe("M42 · notification routing — same-call failover, no duplicate delivery", () => {
  let providersSvc: ProviderRegistryService;
  let routing: RoutingService;
  let notify: NotificationRoutingService;

  beforeEach(() => {
    vi.clearAllMocks();
    providers = [];
    bindings = [];
    credentials = [];
    capabilityRows = [];
    overrides = [];
    circuitStates = [];
    usageRows = [];
    healthChecks = [];
    providersSvc = new ProviderRegistryService();
    routing = new RoutingService(providersSvc);
    notify = new NotificationRoutingService(providersSvc, routing);
  });

  async function registerEmailProvider(name: string, priority: number, shouldFail = false) {
    const provider = await providersSvc.registerProvider({ name });
    await providersSvc.bindCapability(provider.id, EMAIL_CAPABILITY);
    bindings.find((b) => b.providerId === provider.id)!.priority = priority;
    const adapter = new TestEmailAdapter(provider.id, shouldFail);
    providersSvc.registerAdapter(provider.id, adapter);
    await providersSvc.recordHealthCheck(provider.id, { healthy: true });
    return { provider, adapter };
  }

  it("delivers via the primary when it succeeds — the secondary is never even called", async () => {
    const { provider: primary, adapter: primaryAdapter } = await registerEmailProvider("primary", 100);
    const { adapter: secondaryAdapter } = await registerEmailProvider("secondary", 200);

    const result = await notify.sendEmail("tenant-1", { to: "a@b.com", subject: "hi", body: "hello" });

    expect(result.providerId).toBe(primary.id);
    expect(primaryAdapter.sent).toHaveLength(1);
    expect(secondaryAdapter.sent).toHaveLength(0);
  });

  it("FALLS BACK to the secondary the instant the primary fails — same call, no waiting for the circuit breaker", async () => {
    const { provider: primary } = await registerEmailProvider("primary", 100, /* shouldFail */ true);
    const { provider: secondary, adapter: secondaryAdapter } = await registerEmailProvider("secondary", 200);

    const result = await notify.sendEmail("tenant-1", { to: "a@b.com", subject: "hi", body: "hello" });

    expect(result.providerId).toBe(secondary.id);
    expect(secondaryAdapter.sent).toHaveLength(1);
    expect(secondaryAdapter.sent[0]!["to"]).toBe("a@b.com");
    // Only one message actually reached the recipient — no duplicate delivery.
    expect(secondaryAdapter.sent).toHaveLength(1);
  });

  it("NO DUPLICATE DELIVERY: the loop stops at the first success, the third provider is never attempted", async () => {
    await registerEmailProvider("primary", 100, true);
    const { provider: secondary, adapter: secondaryAdapter } = await registerEmailProvider("secondary", 200, false);
    const { adapter: tertiaryAdapter } = await registerEmailProvider("tertiary", 300, false);

    const result = await notify.sendEmail("tenant-1", { to: "a@b.com", subject: "hi", body: "hello" });

    expect(result.providerId).toBe(secondary.id);
    expect(secondaryAdapter.sent).toHaveLength(1);
    expect(tertiaryAdapter.sent).toHaveLength(0); // never reached
  });

  it("every candidate failing throws, naming every provider actually attempted", async () => {
    await registerEmailProvider("primary", 100, true);
    await registerEmailProvider("secondary", 200, true);

    await expect(notify.sendEmail("tenant-1", { to: "a@b.com", subject: "hi", body: "x" })).rejects.toThrow(/failed on every candidate provider/);
  });
});
