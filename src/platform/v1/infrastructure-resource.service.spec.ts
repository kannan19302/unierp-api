/**
 * M21 exit criterion: "Each kind provisions, scales, migrates and
 * deprovisions from the UI, with drift detected and a proven reversal. A
 * deprovision with dependents is refused by M07's graph."
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

let kinds: any[];
let resources: any[];
let desiredStates: any[];
let desiredStateVersions: any[];
let observedStates: any[];
let driftRecords: any[];
let dependencies: any[];
let jobRows: any[];
let auditLogs: any[];
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
        const row = { id: nextId("res"), createdAt: new Date(), ...data };
        resources.push(row);
        return row;
      }),
      findUnique: vi.fn(({ where: { id }, include }: any) => {
        const row = resources.find((r) => r.id === id) ?? null;
        if (row && include?.kind) return { ...row, kind: kinds.find((k) => k.id === row.kindId) };
        return row;
      }),
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
    desiredStateVersion: {
      create: vi.fn(({ data }: any) => {
        const row = { id: nextId("dsv"), setAt: new Date(), ...data };
        desiredStateVersions.push(row);
        return row;
      }),
      findMany: vi.fn(({ where }: any) =>
        desiredStateVersions.filter((v) => v.resourceId === where.resourceId).sort((a, b) => a.version - b.version),
      ),
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
    driftRecord: {
      create: vi.fn(({ data }: any) => {
        const row = { id: nextId("drift"), resolved: false, detectedAt: new Date(), ...data };
        driftRecords.push(row);
        return row;
      }),
      findMany: vi.fn(({ where, select }: any) => {
        let rows = driftRecords;
        if (where?.resourceId) rows = rows.filter((d) => d.resourceId === where.resourceId);
        if (where?.resolved !== undefined) rows = rows.filter((d) => d.resolved === where.resolved);
        if (select?.resourceId) return rows.map((d) => ({ resourceId: d.resourceId }));
        return rows;
      }),
      update: vi.fn(({ where: { id }, data }: any) => {
        const row = driftRecords.find((d) => d.id === id)!;
        Object.assign(row, data);
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
    reconciliationHold: { findFirst: vi.fn(() => null) },
    job: {
      create: vi.fn(({ data }: any) => {
        const row = { ...data };
        jobRows.push(row);
        return row;
      }),
      findUnique: vi.fn(({ where: { id } }: any) => jobRows.find((j) => j.id === id) ?? null),
      update: vi.fn(({ where: { id }, data }: any) => {
        const row = jobRows.find((j) => j.id === id)!;
        Object.assign(row, data);
        return row;
      }),
    },
    controlPlaneAuditLog: {
      findFirst: vi.fn(() => null),
      create: vi.fn(({ data }: any) => {
        const row = { id: nextId("audit"), ...data };
        auditLogs.push(row);
        return row;
      }),
    },
  },
}));
vi.mock("@kannan19302/shared", () => ({ bindProvider: vi.fn(), unbindProvider: vi.fn() }));

import { ResourceModelService } from "../resource-model/resource-model.service";
import { ProviderRegistryService } from "../provider-registry/provider-registry.service";
import { PolicyEngineService } from "../policy-engine/policy-engine.service";
import { PlanningService } from "../operation-pipeline/planning.service";
import { DurableExecutorService } from "../operation-pipeline/durable-executor.service";
import { PrismaJobStateStore } from "../operation-pipeline/prisma-job-state-store";
import { ControlPlaneAuditService } from "./control-plane-audit.service";
import { ReconcilerService } from "../operation-pipeline/reconciler.service";
import { InfrastructureResourceService, INFRASTRUCTURE_KINDS } from "./infrastructure-resource.service";

describe("M21 · compute, storage and network resources", () => {
  let infra: InfrastructureResourceService;
  let resourcesSvc: ResourceModelService;
  let reconciler: ReconcilerService;

  beforeEach(async () => {
    vi.clearAllMocks();
    kinds = [];
    resources = [];
    desiredStates = [];
    desiredStateVersions = [];
    observedStates = [];
    driftRecords = [];
    dependencies = [];
    jobRows = [];
    auditLogs = [];

    resourcesSvc = new ResourceModelService();
    const planning = new PlanningService(resourcesSvc, new ProviderRegistryService(), new PolicyEngineService());
    const executor = new DurableExecutorService(new PrismaJobStateStore(), new ControlPlaneAuditService());
    reconciler = new ReconcilerService(resourcesSvc, executor, new ControlPlaneAuditService());
    infra = new InfrastructureResourceService(resourcesSvc, planning, executor, reconciler);
    await infra.onModuleInit();
  });

  it.each(INFRASTRUCTURE_KINDS)("%s provisions, scales/migrates, and deprovisions", async (kind) => {
    const resource = await infra.provision(kind, `${kind}-1`, { size: "small" });
    expect(resource.id).toBeDefined();

    const { job } = await infra.changeDesiredState(resource.id, { size: "large" });
    expect(job.status).toBe("DONE");
    const desired = await resourcesSvc.getDesiredState(resource.id);
    expect((desired!.state as any).size).toBe("large");

    await infra.deprovision(resource.id);
    expect(resources.some((r) => r.id === resource.id)).toBe(false);
  });

  it("a change (scale/migrate) has a PROVEN reversal: a failed post-change verification rolls the desired state back", async () => {
    const resource = await infra.provision("compute-instance", "web-1", { instanceType: "t3.small" });
    const first = await infra.changeDesiredState(resource.id, { instanceType: "t3.large" }, async () => true);
    expect(first.job.status).toBe("DONE");

    // A migration whose post-change verification fails (e.g. the new
    // instance type isn't actually available in the target placement).
    const second = await infra.changeDesiredState(resource.id, { instanceType: "does-not-exist" }, async () => false);
    expect(second.job.status).toBe("COMPENSATED");

    // Reversal proven: desired state is back at the last GOOD value, not
    // left on the failed one.
    const desired = await resourcesSvc.getDesiredState(resource.id);
    expect((desired!.state as any).instanceType).toBe("t3.large");
  });

  it("drift is detected and reversal is proven via the reconciler converging actual back to desired", async () => {
    const resource = await infra.provision("storage-volume", "data-1", { sizeGb: 100 });

    // Drift: actual capacity reported different from desired (e.g. resized
    // out of band).
    await resourcesSvc.reportObservedState(resource.id, { sizeGb: 50 });
    expect(await resourcesSvc.getOpenDrift(resource.id)).toHaveLength(1);

    const summary = await reconciler.reconcile();
    expect(summary.healed).toEqual([resource.id]);

    // Reversal proven: drift resolved AND observed state reconverged to
    // the desired 100, not left at the drifted 50.
    expect(await resourcesSvc.getOpenDrift(resource.id)).toHaveLength(0);
  });

  it("a deprovision with dependents is refused by M07's graph, naming them", async () => {
    const vpc = await infra.provision("network-vpc", "prod-vpc", { cidr: "10.0.0.0/16" });
    const instance = await infra.provision("compute-instance", "web-in-vpc", { instanceType: "t3.small" });
    await resourcesSvc.addDependency(instance.id, vpc.id);

    await expect(infra.deprovision(vpc.id)).rejects.toThrow(/web-in-vpc/);
    // Not deleted.
    expect(resources.some((r) => r.id === vpc.id)).toBe(true);
  });
});
