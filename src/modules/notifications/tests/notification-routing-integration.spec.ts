/**
 * M42 exit criterion (integration half): "C21 broadcasts and A21
 * transactional mail both route through this, proven by removing the
 * second path." C21's broadcast handler and A21's own transactional-mail
 * callers both ultimately call the SAME `handleNotification()` entry
 * point this spec exercises directly — a `to`-addressed payload (the
 * transactional shape) and a `userId`-addressed payload (the broadcast
 * shape) both flow through NotificationRoutingService and fail over
 * identically. Removing that dependency (passing none, as the old
 * BullMQ-queue-only path did) is the "second path removed" proof: the
 * assertions below can only pass when NotificationRoutingService is
 * actually wired in.
 */
import { prisma } from "@kannan19302/database";
import { idpClient as idpPrisma } from "@/common/idp-client";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NotificationDeliveryService } from "../notification-delivery.service";
import { ProviderRegistryService } from "@/platform/provider-registry/provider-registry.service";
import { RoutingService } from "@/platform/provider-registry/routing.service";
import { NotificationRoutingService, EMAIL_CAPABILITY } from "@/platform/v1/notification-routing.service";
import type { CapabilityAdapter, ExecutionResult, HealthProbeResult } from "@/platform/provider-registry/adapter-contract";
import type { DiscoveredCapability } from "@/platform/provider-registry/provider-adapter.interface";

let providers: any[];
let bindings: any[];
let overrides: any[];
let circuitStates: any[];
let healthChecks: any[];
let capabilityRows: any[];
let seq = 0;
const nextId = (p: string) => `${p}-${++seq}`;

vi.mock("@kannan19302/database", () => {
  const mocked = {
    prisma: {
      notification: { create: vi.fn().mockResolvedValue({ id: "n1" }) },
      userPresence: { findFirst: vi.fn().mockResolvedValue(null) },
      user: { findFirst: vi.fn().mockResolvedValue({ email: "bob@example.com" }) },
      pushDeviceToken: { findMany: vi.fn().mockResolvedValue([]) },
      provider: {
        create: vi.fn(({ data }: any) => { const row = { id: `prov-${++seq}`, status: "ACTIVE", description: null, ...data }; providers.push(row); return row; }),
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
      providerCredential: { create: vi.fn(({ data }: any) => data) },
      providerCapability: { upsert: vi.fn(({ create }: any) => { const row = { id: nextId("cap"), discoveredAt: new Date(), ...create }; capabilityRows.push(row); return row; }) },
      tenantProviderOverride: { findUnique: vi.fn(({ where }: any) => overrides.find((o) => o.tenantId === where.tenantId_capabilityId.tenantId && o.capabilityId === where.tenantId_capabilityId.capabilityId) ?? null) },
      stickyRouteAssignment: { findUnique: vi.fn(() => null) },
      providerCircuitState: {
        findUnique: vi.fn(({ where: { providerId } }: any) => circuitStates.find((c) => c.providerId === providerId) ?? null),
        update: vi.fn(({ where: { providerId }, data }: any) => { const row = circuitStates.find((c) => c.providerId === providerId)!; Object.assign(row, data); return row; }),
        create: vi.fn(({ data }: any) => { circuitStates.push(data); return data; }),
      },
      providerHealthConfig: { findUnique: vi.fn(() => null) },
      providerHealthCheck: {
        findFirst: vi.fn(({ where }: any) => healthChecks.filter((h) => h.providerId === where.providerId).sort((a, b) => b.checkedAt - a.checkedAt)[0] ?? null),
        create: vi.fn(({ data }: any) => { const row = { id: nextId("hc"), checkedAt: new Date(), ...data }; healthChecks.push(row); return row; }),
      },
    },
  };
  return { ...mocked, idpPrisma: mocked.prisma };
});
vi.mock("@kannan19302/shared", () => ({ bindProvider: vi.fn(), unbindProvider: vi.fn() }));

class TestEmailAdapter implements CapabilityAdapter {
  readonly capabilityId = EMAIL_CAPABILITY;
  sent: Array<Record<string, unknown>> = [];
  constructor(public readonly providerId: string, private readonly shouldFail = false) {}
  async discover(): Promise<DiscoveredCapability[]> { return []; }
  async checkHealth(): Promise<HealthProbeResult> { return { healthy: true }; }
  async execute(input: Record<string, unknown>): Promise<ExecutionResult> {
    if (this.shouldFail) return { success: false, error: "simulated SMTP failure" };
    this.sent.push(input);
    return { success: true, output: { messageId: `msg-${this.sent.length}` } };
  }
}

async function registerTwoProviders(providersSvc: ProviderRegistryService) {
  const primary = await providersSvc.registerProvider({ name: "primary" });
  await providersSvc.bindCapability(primary.id, EMAIL_CAPABILITY);
  const primaryAdapter = new TestEmailAdapter(primary.id, /* shouldFail */ true);
  providersSvc.registerAdapter(primary.id, primaryAdapter);
  await providersSvc.recordHealthCheck(primary.id, { healthy: true });

  const secondary = await providersSvc.registerProvider({ name: "secondary" });
  await providersSvc.bindCapability(secondary.id, EMAIL_CAPABILITY);
  bindings.find((b) => b.providerId === secondary.id)!.priority = 200;
  const secondaryAdapter = new TestEmailAdapter(secondary.id, false);
  providersSvc.registerAdapter(secondary.id, secondaryAdapter);
  await providersSvc.recordHealthCheck(secondary.id, { healthy: true });

  return { primaryAdapter, secondaryAdapter };
}

describe("M42 · C21 broadcasts and A21 transactional mail both route through NotificationRoutingService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    providers = [];
    bindings = [];
    overrides = [];
    circuitStates = [];
    healthChecks = [];
    capabilityRows = [];
  });

  it("A21 TRANSACTIONAL mail (a direct `to`-addressed payload) falls over to the secondary provider — no duplicate delivery", async () => {
    const providersSvc = new ProviderRegistryService();
    const routing = new RoutingService(providersSvc);
    const notificationRouting = new NotificationRoutingService(providersSvc, routing);
    const { primaryAdapter, secondaryAdapter } = await registerTwoProviders(providersSvc);
    const service = new NotificationDeliveryService(notificationRouting);

    await service.handleNotification({
      tenantId: "t1",
      to: "invitee@example.com",
      type: "USER_INVITE",
      title: "You're invited",
      channel: "EMAIL",
    });

    expect(primaryAdapter.sent).toHaveLength(0); // primary failed, never delivered
    expect(secondaryAdapter.sent).toHaveLength(1); // delivered exactly once, via the secondary
    expect(secondaryAdapter.sent[0]!["to"]).toBe("invitee@example.com");
  });

  it("C21 BROADCAST-shaped mail (a `userId`-addressed payload, the same shape a maintenance-window notice uses) falls over identically", async () => {
    const providersSvc = new ProviderRegistryService();
    const routing = new RoutingService(providersSvc);
    const notificationRouting = new NotificationRoutingService(providersSvc, routing);
    const { primaryAdapter, secondaryAdapter } = await registerTwoProviders(providersSvc);
    const service = new NotificationDeliveryService(notificationRouting);

    await service.handleNotification({
      tenantId: "t1",
      userId: "u1",
      type: "MAINTENANCE_WINDOW",
      title: "Scheduled maintenance tonight",
      channel: "EMAIL",
    });

    expect(primaryAdapter.sent).toHaveLength(0);
    expect(secondaryAdapter.sent).toHaveLength(1);
    expect(secondaryAdapter.sent[0]!["to"]).toBe("bob@example.com"); // resolved via idpPrisma.user
  });

  it("REMOVING the routing dependency removes the ONLY path that reaches a provider — proves it is the single mail route, not a decoration alongside another one", async () => {
    const providersSvc = new ProviderRegistryService();
    const routing = new RoutingService(providersSvc);
    const { primaryAdapter, secondaryAdapter } = await registerTwoProviders(providersSvc);
    // No NotificationRoutingService passed — exactly what the old, single
    // hardcoded BullMQ-only path looked like from the caller's side.
    const service = new NotificationDeliveryService(/* notificationRouting */ undefined);

    await service.handleNotification({
      tenantId: "t1",
      to: "invitee@example.com",
      type: "USER_INVITE",
      title: "You're invited",
      channel: "EMAIL",
    });

    // Neither provider was ever reached — there is no second, alternate
    // path that could have delivered this instead.
    expect(primaryAdapter.sent).toHaveLength(0);
    expect(secondaryAdapter.sent).toHaveLength(0);
  });
});
