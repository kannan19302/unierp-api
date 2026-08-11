/**
 * M36 exit criterion: "A restore is rehearsed and reconciles; the
 * measured RPO and RTO are recorded against the objective and a miss is
 * a failure, not a note. A region failover is rehearsed with a proven
 * failback. Distinct from C22 migration — asserted."
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

let backupPolicies: any[];
let restoreRehearsals: any[];
let failoverRehearsals: any[];
let kinds: any[];
let resources: any[];
let desiredStates: any[];
let desiredStateVersions: any[];
let jobRows: any[];
let auditLogs: any[];
let tenantCalls: number;
let seq = 0;
const nextId = (p: string) => `${p}-${++seq}`;

vi.mock("@kannan19302/database", () => ({
  prisma: {
    backupPolicy: {
      upsert: vi.fn(({ where: { resourceId }, create, update }: any) => {
        const existing = backupPolicies.find((p) => p.resourceId === resourceId);
        if (existing) {
          Object.assign(existing, update);
          return existing;
        }
        const row = { id: nextId("policy"), ...create };
        backupPolicies.push(row);
        return row;
      }),
      findUnique: vi.fn(({ where: { resourceId } }: any) => backupPolicies.find((p) => p.resourceId === resourceId) ?? null),
    },
    restoreRehearsal: {
      create: vi.fn(({ data }: any) => {
        const row = { id: nextId("restore"), rehearsedAt: new Date(), ...data };
        restoreRehearsals.push(row);
        return row;
      }),
    },
    failoverRehearsal: {
      create: vi.fn(({ data }: any) => {
        const row = { id: nextId("failover"), failedOverAt: new Date(), failbackAt: null, failbackVerified: false, ...data };
        failoverRehearsals.push(row);
        return row;
      }),
      findUnique: vi.fn(({ where: { id } }: any) => failoverRehearsals.find((f) => f.id === id) ?? null),
      update: vi.fn(({ where: { id }, data }: any) => {
        const row = failoverRehearsals.find((f) => f.id === id)!;
        Object.assign(row, data);
        return row;
      }),
    },
    // C22's own models -- untouched by this file. Spied on to PROVE
    // "distinct from C22 migration" mechanically, not just by absence of
    // an import.
    tenant: { findUniqueOrThrow: vi.fn(() => { tenantCalls++; return {}; }) },
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
import { DisasterRecoveryService } from "./disaster-recovery.service";

describe("M36 · backup, restore, DR and failover", () => {
  let dr: DisasterRecoveryService;
  let resourcesSvc: ResourceModelService;

  beforeEach(() => {
    vi.clearAllMocks();
    backupPolicies = [];
    restoreRehearsals = [];
    failoverRehearsals = [];
    kinds = [];
    resources = [];
    desiredStates = [];
    desiredStateVersions = [];
    jobRows = [];
    auditLogs = [];
    tenantCalls = 0;

    resourcesSvc = new ResourceModelService();
    dr = new DisasterRecoveryService(
      resourcesSvc,
      new PlanningService(resourcesSvc, new ProviderRegistryService(), new PolicyEngineService()),
      new DurableExecutorService(new PrismaJobStateStore(), new ControlPlaneAuditService()),
    );
  });

  it("a restore is rehearsed and RECONCILES, measured RPO/RTO recorded against the objective, WITHIN objective passes", async () => {
    await resourcesSvc.registerResourceKind("k", "k");
    const resource = await resourcesSvc.createResource("k", "db-primary", { size: "small" });
    await dr.setBackupPolicy(resource.id, 60, 120); // RPO <=60m, RTO <=120m

    const t0 = new Date("2026-08-11T00:00:00Z");
    const rehearsal = await dr.rehearseRestore(
      resource.id,
      { size: "small", restoredFrom: "backup-1" },
      t0, // lastBackupAt
      new Date(t0.getTime() + 30 * 60000), // failureAt: 30m of data loss
      new Date(t0.getTime() + 40 * 60000), // restoreStartedAt
      new Date(t0.getTime() + 100 * 60000), // restoreCompletedAt: 60m to restore
    );

    expect(rehearsal.passed).toBe(true);
    expect(rehearsal.reconciled).toBe(true);
    expect(rehearsal.measuredRpoMinutes).toBe(30);
    expect(rehearsal.measuredRtoMinutes).toBe(60);

    const desired = await resourcesSvc.getDesiredState(resource.id);
    expect((desired!.state as any).restoredFrom).toBe("backup-1");
  });

  it("a MISS on either objective is a FAILURE (throws), not a note -- and is still recorded", async () => {
    await resourcesSvc.registerResourceKind("k", "k");
    const resource = await resourcesSvc.createResource("k", "db-slow", { size: "small" });
    await dr.setBackupPolicy(resource.id, 15, 30); // tight objectives

    const t0 = new Date("2026-08-11T00:00:00Z");
    await expect(
      dr.rehearseRestore(
        resource.id,
        { size: "small" },
        t0,
        new Date(t0.getTime() + 60 * 60000), // 60m of data loss -- RPO objective missed
        new Date(t0.getTime() + 60 * 60000),
        new Date(t0.getTime() + 65 * 60000), // 5m to restore -- RTO fine
      ),
    ).rejects.toThrow(/FAILED.*RPO missed/);

    // Still recorded -- a failed rehearsal is not swallowed.
    expect(restoreRehearsals).toHaveLength(1);
    expect(restoreRehearsals[0].passed).toBe(false);
  });

  it("a region failover is rehearsed with a PROVEN failback", async () => {
    await resourcesSvc.registerResourceKind("k", "k");
    const resource = await resourcesSvc.createResource("k", "compute-a", { region: "us-east-1" });

    const failover = await dr.rehearseFailover(resource.id, "us-east-1", "eu-west-1");
    let desired = await resourcesSvc.getDesiredState(resource.id);
    expect((desired!.state as any).region).toBe("eu-west-1");

    // The failback is a SEPARATE, later call -- not automatic.
    const failedBack = await dr.rehearseFailback(failover.id);
    expect(failedBack.failbackVerified).toBe(true);
    expect(failedBack.failbackAt).not.toBeNull();

    desired = await resourcesSvc.getDesiredState(resource.id);
    expect((desired!.state as any).region).toBe("us-east-1"); // genuinely reverted
  });

  it("is DISTINCT FROM C22 migration -- a full backup/restore/failover/failback cycle never touches any C22-owned model", async () => {
    await resourcesSvc.registerResourceKind("k", "k");
    const resource = await resourcesSvc.createResource("k", "isolated-resource", { region: "us-east-1", size: "small" });
    await dr.setBackupPolicy(resource.id, 60, 60);

    const t0 = new Date("2026-08-11T00:00:00Z");
    await dr.rehearseRestore(resource.id, { size: "small" }, t0, new Date(t0.getTime() + 10 * 60000), new Date(t0.getTime() + 10 * 60000), new Date(t0.getTime() + 20 * 60000));
    const failover = await dr.rehearseFailover(resource.id, "us-east-1", "eu-west-1");
    await dr.rehearseFailback(failover.id);

    // C22's own model (Tenant, via prisma.tenant.findUniqueOrThrow) was
    // never called by any of this -- the mechanical proof of distinctness.
    expect(tenantCalls).toBe(0);
  });
});
