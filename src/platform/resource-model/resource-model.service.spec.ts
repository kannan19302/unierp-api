/**
 * M07 exit criterion: "A resource whose actual state is changed out of band
 * is reported as drifted, with a diff naming the fields. The dependency
 * graph refuses a cycle. Deleting a resource with dependents is refused
 * with the dependents named, not with a foreign-key error."
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

let kinds: any[];
let resources: any[];
let desiredStates: any[];
let observedStates: any[];
let dependencies: any[];
let driftRecords: any[];
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
      delete: vi.fn(({ where: { id } }: any) => {
        resources = resources.filter((r) => r.id !== id);
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
    observedState: {
      upsert: vi.fn(({ where: { resourceId }, create, update }: any) => {
        const existing = observedStates.find((o) => o.resourceId === resourceId);
        if (existing) {
          Object.assign(existing, update);
          return existing;
        }
        const row = { id: nextId("os"), ...create };
        observedStates.push(row);
        return row;
      }),
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
    driftRecord: {
      create: vi.fn(({ data }: any) => {
        const row = { id: nextId("drift"), resolved: false, detectedAt: new Date(), ...data };
        driftRecords.push(row);
        return row;
      }),
      findMany: vi.fn(({ where }: any) =>
        driftRecords.filter((d) => d.resourceId === where.resourceId && d.resolved === where.resolved),
      ),
      update: vi.fn(({ where: { id }, data }: any) => {
        const row = driftRecords.find((d) => d.id === id)!;
        Object.assign(row, data);
        return row;
      }),
    },
  },
}));

import { ResourceModelService } from "./resource-model.service";

describe("M07 · resource model — desired state, actual, drift", () => {
  let service: ResourceModelService;

  beforeEach(() => {
    vi.clearAllMocks();
    kinds = [];
    resources = [];
    desiredStates = [];
    observedStates = [];
    dependencies = [];
    driftRecords = [];
    service = new ResourceModelService();
  });

  it("a resource whose actual state changes out of band is reported as drifted, with a diff naming the fields", async () => {
    await service.registerResourceKind("dns-zone", "A DNS zone");
    const r = await service.createResource("dns-zone", "acme.example.com zone", {
      recordCount: 3,
      ttl: 300,
      nameservers: ["ns1.example.com", "ns2.example.com"],
    });

    // No drift yet: observed matches desired exactly.
    const noDrift = await service.reportObservedState(r.id, {
      recordCount: 3,
      ttl: 300,
      nameservers: ["ns1.example.com", "ns2.example.com"],
    });
    expect(noDrift.diff).toEqual([]);
    expect(noDrift.driftRecord).toBeNull();

    // Out-of-band change: someone edited the TTL and added a record directly.
    const drifted = await service.reportObservedState(r.id, {
      recordCount: 4,
      ttl: 60,
      nameservers: ["ns1.example.com", "ns2.example.com"],
    });

    expect(drifted.diff).toHaveLength(2);
    const fields = drifted.diff.map((d) => d.field).sort();
    expect(fields).toEqual(["recordCount", "ttl"]);

    const ttlDiff = drifted.diff.find((d) => d.field === "ttl")!;
    expect(ttlDiff.desiredValue).toBe(300);
    expect(ttlDiff.observedValue).toBe(60);

    expect(drifted.driftRecord).not.toBeNull();
    expect(drifted.driftRecord.resolved).toBe(false);

    const open = await service.getOpenDrift(r.id);
    expect(open).toHaveLength(1);
  });

  it("diffStates is correct in isolation — the exact mechanism the exit criterion names", () => {
    const diffs = service.diffStates(
      { a: 1, b: "same", c: [1, 2, 3] },
      { a: 2, b: "same", c: [1, 2, 3, 4] },
    );
    const fields = diffs.map((d) => d.field).sort();
    expect(fields).toEqual(["a", "c"]);
  });

  it("the dependency graph refuses a direct cycle", async () => {
    await service.registerResourceKind("k", "k");
    const a = await service.createResource("k", "A");
    const b = await service.createResource("k", "B");

    await service.addDependency(a.id, b.id); // A depends on B — fine
    await expect(service.addDependency(b.id, a.id)).rejects.toThrow(/cycle/i); // B depends on A -> cycle
  });

  it("the dependency graph refuses a transitive (3-node) cycle", async () => {
    await service.registerResourceKind("k", "k");
    const a = await service.createResource("k", "A");
    const b = await service.createResource("k", "B");
    const c = await service.createResource("k", "C");

    await service.addDependency(a.id, b.id); // A -> B
    await service.addDependency(b.id, c.id); // B -> C
    await expect(service.addDependency(c.id, a.id)).rejects.toThrow(/cycle/i); // C -> A closes A->B->C->A
  });

  it("a resource cannot depend on itself", async () => {
    await service.registerResourceKind("k", "k");
    const a = await service.createResource("k", "A");
    await expect(service.addDependency(a.id, a.id)).rejects.toThrow();
  });

  it("deleting a resource with dependents is refused with the dependents named, not a foreign-key error", async () => {
    await service.registerResourceKind("k", "k");
    const parent = await service.createResource("k", "Shared VPC");
    const child1 = await service.createResource("k", "Web tier subnet");
    const child2 = await service.createResource("k", "DB tier subnet");

    await service.addDependency(child1.id, parent.id);
    await service.addDependency(child2.id, parent.id);

    await expect(service.deleteResource(parent.id)).rejects.toThrow(
      /Web tier subnet.*DB tier subnet|DB tier subnet.*Web tier subnet/s,
    );
    // Not deleted.
    expect(resources.some((r) => r.id === parent.id)).toBe(true);
  });

  it("deleting a resource with no dependents succeeds", async () => {
    await service.registerResourceKind("k", "k");
    const a = await service.createResource("k", "Standalone");
    await service.deleteResource(a.id);
    expect(resources.some((r) => r.id === a.id)).toBe(false);
  });
});
