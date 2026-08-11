/**
 * M14 exit criterion (rollback half): "Any resource is rolled back to any
 * prior version by selecting it, and the rollback is itself a versioned
 * plan."
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

let kinds: any[];
let resources: any[];
let desiredStates: any[];
let desiredStateVersions: any[];
let dependencies: any[];
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
    desiredStateVersion: {
      create: vi.fn(({ data }: any) => {
        const row = { id: nextId("dsv"), setAt: new Date(), ...data };
        desiredStateVersions.push(row);
        return row;
      }),
      findUnique: vi.fn(({ where }: any) => {
        const k = where.resourceId_version;
        return desiredStateVersions.find((v) => v.resourceId === k.resourceId && v.version === k.version) ?? null;
      }),
      findMany: vi.fn(({ where }: any) =>
        desiredStateVersions.filter((v) => v.resourceId === where.resourceId).sort((a, b) => a.version - b.version),
      ),
    },
    dependency: { findMany: vi.fn(() => []) },
    providerPriceSheetEntry: { findUnique: vi.fn(() => null) },
    providerHealthConfig: { findUnique: vi.fn(() => null) },
    providerHealthCheck: { findFirst: vi.fn(() => null), create: vi.fn() },
    observedState: { upsert: vi.fn() },
    driftRecord: { create: vi.fn(), findMany: vi.fn(() => []) },
  },
}));
vi.mock("@kannan19302/shared", () => ({ bindProvider: vi.fn(), unbindProvider: vi.fn() }));

import { ResourceModelService } from "../resource-model/resource-model.service";
import { ProviderRegistryService } from "../provider-registry/provider-registry.service";
import { PolicyEngineService } from "../policy-engine/policy-engine.service";
import { PlanningService } from "./planning.service";

describe("M14 · versioning and rollback", () => {
  let resourcesSvc: ResourceModelService;
  let planning: PlanningService;

  beforeEach(() => {
    vi.clearAllMocks();
    kinds = [];
    resources = [];
    desiredStates = [];
    desiredStateVersions = [];
    dependencies = [];
    resourcesSvc = new ResourceModelService();
    planning = new PlanningService(resourcesSvc, new ProviderRegistryService(), new PolicyEngineService());
  });

  it("every setDesiredState call is versioned — history accumulates rather than being overwritten", async () => {
    await resourcesSvc.registerResourceKind("k", "k");
    const r = await resourcesSvc.createResource("k", "res-1", { color: "blue" }); // version 1
    await resourcesSvc.setDesiredState(r.id, { color: "green" }); // version 2
    await resourcesSvc.setDesiredState(r.id, { color: "red" }); // version 3

    const versions = await resourcesSvc.listDesiredStateVersions(r.id);
    expect(versions.map((v: any) => v.version)).toEqual([1, 2, 3]);
    expect(versions.map((v: any) => v.state)).toEqual([{ color: "blue" }, { color: "green" }, { color: "red" }]);

    const current = await resourcesSvc.getDesiredState(r.id);
    expect(current.version).toBe(3);
    expect(current.state).toEqual({ color: "red" });
  });

  it("any resource is rolled back to ANY prior version by selecting it — not only the immediately previous one", async () => {
    await resourcesSvc.registerResourceKind("k", "k");
    const r = await resourcesSvc.createResource("k", "res-2", { size: "small" }); // v1
    await resourcesSvc.setDesiredState(r.id, { size: "medium" }); // v2
    await resourcesSvc.setDesiredState(r.id, { size: "large" }); // v3
    await resourcesSvc.setDesiredState(r.id, { size: "xlarge" }); // v4

    // Roll back to v1, not v3 — proving arbitrary version selection, not
    // only "undo the last change."
    const plan = await planning.rollback(r.id, 1);

    expect(plan.diff).toEqual([{ field: "size", desiredValue: "xlarge", observedValue: "small" }]);
    expect(plan.reversal.priorDesiredState).toEqual({ size: "xlarge" });
  });

  it("the rollback is ITSELF a versioned plan: applying it creates a NEW version, not a resurrection of the old row", async () => {
    await resourcesSvc.registerResourceKind("k", "k");
    const r = await resourcesSvc.createResource("k", "res-3", { env: "prod" }); // v1
    await resourcesSvc.setDesiredState(r.id, { env: "staging" }); // v2

    const plan = await planning.rollback(r.id, 1);

    // Applying the plan is what the execution pipeline (M12) would do —
    // simulated here as the direct call, since PlanningService itself
    // deliberately never mutates state (M09's own invariant).
    const proposedState = { ...plan.diff.reduce((acc, d) => ({ ...acc, [d.field]: d.observedValue }), {} as any) };
    await resourcesSvc.setDesiredState(r.id, { env: "prod", ...proposedState });

    const versions = await resourcesSvc.listDesiredStateVersions(r.id);
    expect(versions.map((v: any) => v.version)).toEqual([1, 2, 3]);
    expect(versions[2].state).toEqual({ env: "prod" }); // v3's CONTENT equals v1's
    expect(versions[2].version).not.toBe(versions[0].version); // but it is a genuinely NEW row
  });

  it("rolling back to a version that was never recorded is refused explicitly", async () => {
    await resourcesSvc.registerResourceKind("k", "k");
    const r = await resourcesSvc.createResource("k", "res-4", { v: 1 });

    await expect(planning.rollback(r.id, 99)).rejects.toThrow(/no recorded version 99/i);
  });
});
