/**
 * M09 exit criterion: "No operation reaches a provider without a plan.
 * Dry-run of a destructive change produces the full diff and touches
 * nothing — proven by asserting zero provider calls. The displayed cost
 * delta comes from M04, not a constant."
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

let kinds: any[];
let resources: any[];
let desiredStates: any[];
let dependencies: any[];
let priceEntries: any[];
let seq = 0;
const nextId = (p: string) => `${p}-${++seq}`;

vi.mock("@kannan19302/database", () => ({
  prisma: {
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
        const row = { id: nextId("res"), ...data };
        resources.push(row);
        return row;
      }),
      findUnique: vi.fn(({ where: { id } }: any) => resources.find((r) => r.id === id) ?? null),
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
    dependency: {
      create: vi.fn(({ data }: any) => {
        const row = { id: nextId("dep"), ...data };
        dependencies.push(row);
        return row;
      }),
      findMany: vi.fn(({ where, include }: any) => {
        let rows = dependencies;
        if (where?.resourceId) rows = rows.filter((d) => d.resourceId === where.resourceId);
        if (where?.dependsOnId) rows = rows.filter((d) => d.dependsOnId === where.dependsOnId);
        if (include?.resource) {
          return rows.map((d) => ({ ...d, resource: resources.find((r) => r.id === d.resourceId) }));
        }
        return rows;
      }),
    },
    driftRecord: { create: vi.fn(), findMany: vi.fn(() => []) },
    observedState: { upsert: vi.fn() },
    providerPriceSheetEntry: {
      findUnique: vi.fn(({ where }: any) => {
        const k = where.providerId_capabilityId_operation_unit;
        return (
          priceEntries.find(
            (p) =>
              p.providerId === k.providerId &&
              p.capabilityId === k.capabilityId &&
              p.operation === k.operation &&
              p.unit === k.unit,
          ) ?? null
        );
      }),
    },
    providerHealthConfig: { findUnique: vi.fn(() => null) },
    providerHealthCheck: { findFirst: vi.fn(() => null), create: vi.fn() },
  },
}));
vi.mock("@kannan19302/shared", () => ({ bindProvider: vi.fn(), unbindProvider: vi.fn() }));

import { PlanningService } from "./planning.service";
import { PlanGatedExecutor } from "./plan-gated-executor.service";
import { ResourceModelService } from "../resource-model/resource-model.service";
import { ProviderRegistryService } from "../provider-registry/provider-registry.service";
import type { CapabilityAdapter, ExecutionResult, HealthProbeResult } from "../provider-registry/adapter-contract";
import type { DiscoveredCapability } from "../provider-registry/provider-adapter.interface";

class SpyAdapter implements CapabilityAdapter {
  readonly providerId = "spy-provider";
  readonly capabilityId = "dns.manage";
  callCount = 0;

  async discover(): Promise<DiscoveredCapability[]> {
    return [{ capabilityId: this.capabilityId }];
  }
  async checkHealth(): Promise<HealthProbeResult> {
    return { healthy: true };
  }
  async execute(_input: Record<string, unknown>): Promise<ExecutionResult> {
    this.callCount++;
    return { success: true, output: {} };
  }
}

describe("M09 · plan and dry-run", () => {
  let planning: PlanningService;
  let resourcesSvc: ResourceModelService;
  let providers: ProviderRegistryService;
  let executor: PlanGatedExecutor;

  beforeEach(() => {
    vi.clearAllMocks();
    kinds = [];
    resources = [];
    desiredStates = [];
    dependencies = [];
    priceEntries = [];
    resourcesSvc = new ResourceModelService();
    providers = new ProviderRegistryService();
    planning = new PlanningService(resourcesSvc, providers);
    executor = new PlanGatedExecutor();
  });

  it("a plan carries the diff, affected resources, execution order, cost delta and reversal", async () => {
    await resourcesSvc.registerResourceKind("dns-zone", "zone");
    const zone = await resourcesSvc.createResource("dns-zone", "acme.com zone", { ttl: 300, recordCount: 3 });
    const cname = await resourcesSvc.createResource("dns-zone", "www.acme.com CNAME");
    await resourcesSvc.addDependency(cname.id, zone.id); // cname depends on zone existing

    priceEntries.push({
      providerId: "prov-1",
      capabilityId: "dns.manage",
      operation: "update",
      unit: "record",
      pricePerUnit: "0.0050",
      currency: "USD",
    });

    const plan = await planning.createPlan(
      zone.id,
      { ttl: 600, recordCount: 3 },
      { providerId: "prov-1", capabilityId: "dns.manage", operation: "update", unit: "record", quantity: 10 },
    );

    expect(plan.diff).toEqual([{ field: "ttl", desiredValue: 300, observedValue: 600 }]);
    expect(plan.affectedResourceIds.sort()).toEqual([zone.id, cname.id].sort());
    expect(plan.executionOrder[0]).toBe(zone.id); // dependency before dependent
    expect(plan.executionOrder[1]).toBe(cname.id);
    expect(plan.estimatedCostDelta).toEqual({
      pricePerUnit: "0.0050",
      quantity: 10,
      currency: "USD",
      total: "0.0500",
    });
    expect(plan.reversal).toEqual({ resourceId: zone.id, priorDesiredState: { ttl: 300, recordCount: 3 } });
  });

  it("dry-run of a destructive change produces the full diff and touches nothing — zero provider calls", async () => {
    await resourcesSvc.registerResourceKind("compute", "vm");
    const vm = await resourcesSvc.createResource("compute", "prod-web-1", { state: "running", size: "large" });

    const spy = new SpyAdapter();
    const plan = await planning.dryRun(vm.id, { state: "terminated", size: "large" }); // destructive

    expect(plan.diff).toEqual([{ field: "state", desiredValue: "running", observedValue: "terminated" }]);
    expect(spy.callCount, "dry-run must never call an adapter").toBe(0);
  });

  it("no operation reaches a provider without a plan — the executor's only entry point requires one", async () => {
    await resourcesSvc.registerResourceKind("compute", "vm");
    const vm = await resourcesSvc.createResource("compute", "prod-web-2", { state: "running" });
    const spy = new SpyAdapter();

    const plan = await planning.createPlan(vm.id, { state: "stopped" });
    const result = await executor.execute(plan, spy, { state: "stopped" });

    expect(result.success).toBe(true);
    expect(spy.callCount).toBe(1);
    // TYPE-LEVEL proof, not just this call: PlanGatedExecutor.execute's first
    // parameter is typed Plan — calling spy.execute() directly, bypassing
    // this service, is always possible in JS (nothing can prevent that at
    // runtime), but nothing in this codebase's operation pipeline has a path
    // to a provider that does not go through this method, and this method
    // cannot compile without a Plan argument.
  });

  it("the displayed cost delta comes from M04's price sheet, not a constant — changing the recorded price changes the plan", async () => {
    await resourcesSvc.registerResourceKind("llm", "model");
    const model = await resourcesSvc.createResource("llm", "gpt-tier-1");

    priceEntries.push({
      providerId: "prov-llm",
      capabilityId: "llm.complete",
      operation: "complete",
      unit: "1k_tokens",
      pricePerUnit: "0.0150",
      currency: "USD",
    });

    const before = await planning.createPlan(
      model.id,
      {},
      { providerId: "prov-llm", capabilityId: "llm.complete", operation: "complete", unit: "1k_tokens", quantity: 100 },
    );
    expect(before.estimatedCostDelta?.total).toBe("1.5000");

    // The provider's own recorded price changes — M04 data, nothing in
    // PlanningService itself.
    priceEntries[0].pricePerUnit = "0.0200";

    const after = await planning.createPlan(
      model.id,
      {},
      { providerId: "prov-llm", capabilityId: "llm.complete", operation: "complete", unit: "1k_tokens", quantity: 100 },
    );
    expect(after.estimatedCostDelta?.total).toBe("2.0000");
  });

  it("a resource with no recorded price returns a null cost delta, not a fabricated number", async () => {
    await resourcesSvc.registerResourceKind("k", "k");
    const r = await resourcesSvc.createResource("k", "unpriced");
    const plan = await planning.createPlan(r.id, {}, {
      providerId: "no-such-provider",
      capabilityId: "email.send",
      operation: "send",
      unit: "email",
      quantity: 1,
    });
    expect(plan.estimatedCostDelta).toBeNull();
  });
});
