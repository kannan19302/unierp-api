/**
 * M29 exit criterion (quota-binding half): "An entitlement change in C13
 * changes the resource quota, proven by asserting the quota after a plan
 * change."
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

let subscriptions: any[];
let kinds: any[];
let resources: any[];
let desiredStates: any[];
let desiredStateVersions: any[];
let seq = 0;
const nextId = (p: string) => `${p}-${++seq}`;

vi.mock("@kannan19302/database", () => ({
  prisma: {
    tenantSubscription: {
      findFirst: vi.fn(({ where, include }: any) => {
        const sub = subscriptions.find((s) => s.tenantId === where.tenantId && s.status === where.status);
        if (!sub) return null;
        return include?.plan ? { ...sub, plan: sub.plan } : sub;
      }),
    },
    resourceKind: {
      upsert: vi.fn(({ where: { name }, create }: any) => {
        const existing = kinds.find((k) => k.name === name);
        if (existing) return existing;
        const row = { id: nextId("kind"), ...create };
        kinds.push(row);
        return row;
      }),
      findUnique: vi.fn(({ where: { name } }: any) => kinds.find((k) => k.name === name) ?? null),
    },
    resource: {
      create: vi.fn(({ data }: any) => {
        const row = { id: nextId("res"), createdAt: new Date(), ...data };
        resources.push(row);
        return row;
      }),
      findUnique: vi.fn(({ where: { id } }: any) => resources.find((r) => r.id === id) ?? null),
      findMany: vi.fn(({ where }: any) => {
        let rows = resources.map((r) => ({ ...r, kind: kinds.find((k) => k.id === r.kindId) }));
        if (where?.kind?.name) rows = rows.filter((r) => r.kind?.name === where.kind.name);
        return rows;
      }),
      count: vi.fn(({ where }: any) => {
        let rows = resources;
        if (where?.kind?.name) rows = rows.filter((r) => kinds.find((k) => k.id === r.kindId)?.name === where.kind.name);
        return rows.length;
      }),
    },
    desiredState: {
      upsert: vi.fn(({ where: { resourceId }, create, update }: any) => {
        const existing = desiredStates.find((d) => d.resourceId === resourceId);
        if (existing) {
          Object.assign(existing, update);
          return existing;
        }
        const row = { id: nextId("ds"), ...create };
        desiredStates.push(row);
        return row;
      }),
      findUnique: vi.fn(({ where: { resourceId } }: any) => desiredStates.find((d) => d.resourceId === resourceId) ?? null),
    },
    desiredStateVersion: {
      create: vi.fn(({ data }: any) => {
        const row = { id: nextId("dsv"), setAt: new Date(), ...data };
        desiredStateVersions.push(row);
        return row;
      }),
    },
    dependency: { findMany: vi.fn(() => []) },
  },
}));
vi.mock("@kannan19302/shared", () => ({ bindProvider: vi.fn(), unbindProvider: vi.fn() }));

import { ResourceModelService } from "../resource-model/resource-model.service";
import { ProviderRegistryService } from "../provider-registry/provider-registry.service";
import { PolicyEngineService } from "../policy-engine/policy-engine.service";
import { PlanningService } from "../operation-pipeline/planning.service";
import { EntitlementQuotaBindingService } from "./entitlement-quota-binding.service";

describe("M29 · budgets, forecasts and quota binding — C13 entitlement -> M07 quota", () => {
  let binding: EntitlementQuotaBindingService;

  beforeEach(() => {
    vi.clearAllMocks();
    subscriptions = [];
    kinds = [];
    resources = [];
    desiredStates = [];
    desiredStateVersions = [];

    const resourcesSvc = new ResourceModelService();
    binding = new EntitlementQuotaBindingService(
      resourcesSvc,
      new PlanningService(resourcesSvc, new ProviderRegistryService(), new PolicyEngineService()),
    );
  });

  it("syncing from the tenant's current plan writes its entitlements as the resource quota", async () => {
    subscriptions.push({
      tenantId: "tenant-1",
      status: "ACTIVE",
      plan: { maxUsers: 10, maxStorage: 5000, maxApiCalls: 100000 },
    });

    const { quota } = await binding.syncQuotaFromEntitlements("tenant-1");
    expect(quota).toEqual({ maxUsers: 10, maxStorage: 5000, maxApiCalls: 100000 });

    const current = await binding.getCurrentQuota("tenant-1");
    expect(current).toEqual({ maxUsers: 10, maxStorage: 5000, maxApiCalls: 100000 });
  });

  it("an entitlement change (upgrading to a different plan) changes the resource quota -- asserted after the plan change, not before", async () => {
    subscriptions.push({
      tenantId: "tenant-1",
      status: "ACTIVE",
      plan: { maxUsers: 10, maxStorage: 5000, maxApiCalls: 100000 },
    });
    await binding.syncQuotaFromEntitlements("tenant-1");
    const before = await binding.getCurrentQuota("tenant-1");
    expect(before!.maxUsers).toBe(10);

    // The entitlement change: the tenant's subscription now points at a
    // different plan with different (higher) entitlements.
    subscriptions[0].plan = { maxUsers: 50, maxStorage: 50000, maxApiCalls: 1000000 };

    await binding.syncQuotaFromEntitlements("tenant-1");
    const after = await binding.getCurrentQuota("tenant-1");

    expect(after).toEqual({ maxUsers: 50, maxStorage: 50000, maxApiCalls: 1000000 });
    expect(after!.maxUsers).not.toBe(before!.maxUsers);
  });

  it("re-syncing the same tenant reuses the same quota resource, not a duplicate", async () => {
    subscriptions.push({ tenantId: "tenant-1", status: "ACTIVE", plan: { maxUsers: 1, maxStorage: 1, maxApiCalls: 1 } });
    const first = await binding.syncQuotaFromEntitlements("tenant-1");
    const second = await binding.syncQuotaFromEntitlements("tenant-1");
    expect(second.resourceId).toBe(first.resourceId);
  });

  it("a tenant with no active subscription is refused explicitly", async () => {
    await expect(binding.syncQuotaFromEntitlements("tenant-none")).rejects.toThrow(/No active subscription/);
  });

  it("a tenant that has never synced has no current quota", async () => {
    const current = await binding.getCurrentQuota("tenant-never-synced");
    expect(current).toBeNull();
  });
});
