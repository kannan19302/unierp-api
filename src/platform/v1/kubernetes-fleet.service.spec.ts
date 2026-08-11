/**
 * M19 exit criterion: "A routing weight is changed through a planned,
 * approved, reconciled operation and reverts on rollback."
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

let kinds: any[];
let resources: any[];
let desiredStates: any[];
let desiredStateVersions: any[];
let routings: any[];
let approvals: any[];
let auditLogs: any[];
let jobRows: any[];
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
      findUnique: vi.fn(({ where: { id } }: any) => resources.find((r) => r.id === id) ?? null),
      findFirst: vi.fn(({ where }: any) => resources.find((r) => r.name === where.name) ?? null),
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
    dependency: {
      findMany: vi.fn(() => []),
    },
    saasTenantNodeRouting: {
      findFirst: vi.fn(({ where }: any) =>
        routings.find((r) => r.tenantId === where.tenantId && r.clusterId === where.clusterId) ?? null,
      ),
      findMany: vi.fn(({ where }: any) => (where?.clusterId ? routings.filter((r) => r.clusterId === where.clusterId) : routings)),
      update: vi.fn(({ where, data }: any) => {
        const k = where.tenantId_clusterId;
        const row = routings.find((r) => r.tenantId === k.tenantId && r.clusterId === k.clusterId)!;
        Object.assign(row, data);
        return row;
      }),
    },
    controlPlaneApproval: {
      create: vi.fn(({ data }: any) => {
        const row = { id: nextId("appr"), approvedBy: null, ...data };
        approvals.push(row);
        return row;
      }),
      findUnique: vi.fn(({ where: { id } }: any) => approvals.find((a) => a.id === id) ?? null),
      update: vi.fn(({ where: { id }, data }: any) => {
        const row = approvals.find((a) => a.id === id)!;
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
  },
}));
vi.mock("@kannan19302/shared", () => ({ bindProvider: vi.fn(), unbindProvider: vi.fn() }));

import { ResourceModelService } from "../resource-model/resource-model.service";
import { ProviderRegistryService } from "../provider-registry/provider-registry.service";
import { PolicyEngineService } from "../policy-engine/policy-engine.service";
import { PlanningService } from "../operation-pipeline/planning.service";
import { SchedulingService } from "../operation-pipeline/scheduling.service";
import { ControlPlaneApprovalsService } from "./control-plane-approvals.service";
import { ControlPlaneAuditService } from "./control-plane-audit.service";
import { DurableExecutorService } from "../operation-pipeline/durable-executor.service";
import { PrismaJobStateStore } from "../operation-pipeline/prisma-job-state-store";
import { KubernetesFleetService } from "./kubernetes-fleet.service";

describe("M19 · Kubernetes fleet operations", () => {
  let fleet: KubernetesFleetService;

  beforeEach(() => {
    vi.clearAllMocks();
    kinds = [];
    resources = [];
    desiredStates = [];
    desiredStateVersions = [];
    routings = [];
    approvals = [];
    auditLogs = [];
    jobRows = [];

    routings.push({
      id: "row-1",
      tenantId: "tenant-1",
      clusterId: "cluster-a",
      nodeGroup: "shared-workers",
      databaseHost: "db.internal",
      redisHost: "redis.internal",
      isDedicated: false,
      weight: 100,
    });

    fleet = new KubernetesFleetService(
      new ResourceModelService(),
      new PlanningService(new ResourceModelService(), new ProviderRegistryService(), new PolicyEngineService()),
      new SchedulingService(new ControlPlaneApprovalsService(new ControlPlaneAuditService())),
      new DurableExecutorService(new PrismaJobStateStore(), new ControlPlaneAuditService()),
    );
  });

  it("a routing weight is changed through a planned, approved, reconciled operation", async () => {
    const { resourceId, approval } = await fleet.proposeRoutingWeight("tenant-1", "cluster-a", 50, "operator-1");
    expect(approval.status).toBe("PENDING");

    // The actual routing table is UNTOUCHED until the approval is decided.
    expect(routings[0].weight).toBe(100);

    const result = await fleet.applyRoutingWeight(approval.id, resourceId, "tenant-1", "cluster-a", 50, "operator-2");

    expect(result.job.status).toBe("DONE");
    expect(routings[0].weight).toBe(50);

    const desired = desiredStates.find((d) => d.resourceId === resourceId);
    expect(desired.state.weight).toBe(50);
  });

  it("the same operator cannot both propose and approve — two-person control applies unmodified", async () => {
    const { resourceId, approval } = await fleet.proposeRoutingWeight("tenant-1", "cluster-a", 50, "operator-1");
    await expect(
      fleet.applyRoutingWeight(approval.id, resourceId, "tenant-1", "cluster-a", 50, "operator-1"),
    ).rejects.toThrow(/cannot also approve/);
    expect(routings[0].weight).toBe(100); // unchanged
  });

  it("reverts on rollback: rolling back to a prior version proposes the historical weight through the same pipeline", async () => {
    const { resourceId, approval } = await fleet.proposeRoutingWeight("tenant-1", "cluster-a", 50, "operator-1");
    await fleet.applyRoutingWeight(approval.id, resourceId, "tenant-1", "cluster-a", 50, "operator-2");
    expect(routings[0].weight).toBe(50);

    // Rollback to version 1 (the original weight: 100).
    const rollbackPlan = await fleet.rollbackRoutingWeight(resourceId, 1, "operator-1");
    expect(rollbackPlan.diff).toEqual([{ field: "weight", desiredValue: 50, observedValue: 100 }]);

    const approval2 = await fleet.proposeRoutingWeight("tenant-1", "cluster-a", 100, "operator-1");
    await fleet.applyRoutingWeight(approval2.approval.id, resourceId, "tenant-1", "cluster-a", 100, "operator-2");

    expect(routings[0].weight).toBe(100); // reverted
  });
});
