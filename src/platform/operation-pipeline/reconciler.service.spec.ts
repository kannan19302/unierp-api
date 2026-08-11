/**
 * M13 exit criterion: "A resource deleted out of band is restored, and the
 * restoration is audited as a reconciliation rather than as an operator
 * action. A reconciler with a mis-set desired state hits the blast-radius
 * limit and stops instead of rebuilding the estate."
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

let kinds: any[];
let resources: any[];
let desiredStates: any[];
let desiredStateVersions: any[];
let observedStates: any[];
let driftRecords: any[];
let holds: any[];
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
        const row = { id: nextId("res"), ...data };
        resources.push(row);
        return row;
      }),
      findUnique: vi.fn(({ where: { id }, include }: any) => {
        const row = resources.find((r) => r.id === id) ?? null;
        if (row && include?.kind) return { ...row, kind: kinds.find((k) => k.id === row.kindId) };
        return row;
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
      findUnique: vi.fn(({ where }: any) => {
        const k = where.resourceId_version;
        return desiredStateVersions.find((v) => v.resourceId === k.resourceId && v.version === k.version) ?? null;
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
    reconciliationHold: {
      create: vi.fn(({ data }: any) => {
        const row = { id: nextId("hold"), releasedAt: null, setAt: new Date(), ...data };
        holds.push(row);
        return row;
      }),
      update: vi.fn(({ where: { id }, data }: any) => {
        const row = holds.find((h) => h.id === id)!;
        Object.assign(row, data);
        return row;
      }),
      findFirst: vi.fn(({ where }: any) => holds.find((h) => h.releasedAt === where.releasedAt) ?? null),
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
import { DurableExecutorService } from "./durable-executor.service";
import { PrismaJobStateStore } from "./prisma-job-state-store";
import { ControlPlaneAuditService } from "../v1/control-plane-audit.service";
import { ReconcilerService } from "./reconciler.service";

describe("M13 · reconciliation and self-healing", () => {
  let resourcesSvc: ResourceModelService;
  let executor: DurableExecutorService;
  let audit: ControlPlaneAuditService;
  let reconciler: ReconcilerService;

  beforeEach(() => {
    vi.clearAllMocks();
    kinds = [];
    resources = [];
    desiredStates = [];
    desiredStateVersions = [];
    observedStates = [];
    driftRecords = [];
    holds = [];
    auditLogs = [];
    jobRows = [];
    resourcesSvc = new ResourceModelService();
    executor = new DurableExecutorService(new PrismaJobStateStore(), new ControlPlaneAuditService());
    audit = new ControlPlaneAuditService();
    reconciler = new ReconcilerService(resourcesSvc, executor, audit);
  });

  it("a resource deleted out of band is restored, and audited as a reconciliation, not an operator action", async () => {
    await resourcesSvc.registerResourceKind("dns-zone", "zone");
    const zone = await resourcesSvc.createResource("dns-zone", "acme.com zone", { recordCount: 3, ttl: 300 });

    const recreateCalls: Array<{ resourceId: string; state: Record<string, unknown> }> = [];
    reconciler.registerHealingStrategy("dns-zone", async (resourceId, desiredState) => {
      recreateCalls.push({ resourceId, state: desiredState });
    });

    // Deleted out of band: the observed state no longer resembles the
    // desired one at all — the same drift mechanism M07 already uses.
    await resourcesSvc.reportObservedState(zone.id, { __deleted: true });
    expect(await resourcesSvc.getOpenDrift(zone.id)).toHaveLength(1);

    const summary = await reconciler.reconcile();

    expect(summary.held).toBe(false);
    expect(summary.blastRadiusExceeded).toBe(false);
    expect(summary.healed).toEqual([zone.id]);
    expect(recreateCalls).toEqual([{ resourceId: zone.id, state: { recordCount: 3, ttl: 300 } }]);

    // Drift resolved — the resource is no longer "open."
    expect(await resourcesSvc.getOpenDrift(zone.id)).toHaveLength(0);

    // Two audit records for one healing action, by M14's design: a generic
    // "a pipeline step ran" record (DurableExecutorService's own audit
    // gate, actorId "system:pipeline") and this phase's domain-specific
    // "this was a reconciliation" record. The exit criterion's own words —
    // audited AS A RECONCILIATION, not an operator action — are what the
    // SECOND record proves; its presence, not the total count, is the test.
    const reconciliationRecords = auditLogs.filter((a) => a.action === "reconciliation.restore");
    expect(reconciliationRecords).toHaveLength(1);
    expect(reconciliationRecords[0].actorId).toBe("system:reconciler");
    expect(reconciliationRecords[0].targetId).toBe(zone.id);
    expect(auditLogs.every((a) => a.actorId !== undefined), "no record may be attributed to no one").toBe(true);
  });

  it("a reconciler with a mis-set desired state hits the blast-radius limit and stops instead of rebuilding the estate", async () => {
    reconciler.setMaxBlastRadius(3);
    await resourcesSvc.registerResourceKind("k", "k");

    const healed: string[] = [];
    reconciler.registerHealingStrategy("k", async (resourceId) => {
      healed.push(resourceId);
    });

    // A "mis-set desired state" scenario: 5 resources all drifted at once
    // (e.g. a bad bulk desired-state change), exceeding the limit of 3.
    for (let i = 0; i < 5; i++) {
      const r = await resourcesSvc.createResource("k", `res-${i}`, { v: 1 });
      await resourcesSvc.reportObservedState(r.id, { v: 2 });
    }

    const summary = await reconciler.reconcile();

    expect(summary.blastRadiusExceeded).toBe(true);
    expect(summary.candidateCount).toBe(5);
    expect(summary.healed).toEqual([]);
    expect(healed, "the estate must not be partially healed either — a full stop, not a partial one").toHaveLength(0);
  });

  it("a manual hold suppresses healing entirely, even with drift present", async () => {
    await resourcesSvc.registerResourceKind("k", "k");
    const r = await resourcesSvc.createResource("k", "res-x", { v: 1 });
    await resourcesSvc.reportObservedState(r.id, { v: 2 });

    const healed: string[] = [];
    reconciler.registerHealingStrategy("k", async (resourceId) => {
      healed.push(resourceId);
    });

    await reconciler.setHold("investigating an incident", "sre-1");
    const summary = await reconciler.reconcile();

    expect(summary.held).toBe(true);
    expect(healed).toHaveLength(0);

    // Releasing the hold restores normal operation.
    const hold = holds[0];
    await reconciler.releaseHold(hold.id);
    const summaryAfterRelease = await reconciler.reconcile();
    expect(summaryAfterRelease.held).toBe(false);
    expect(healed).toEqual([r.id]);
  });

  it("healing a resource with no registered strategy is refused explicitly, not silently skipped", async () => {
    await resourcesSvc.registerResourceKind("unstrategized-kind", "k");
    const r = await resourcesSvc.createResource("unstrategized-kind", "res-y", { v: 1 });
    await resourcesSvc.reportObservedState(r.id, { v: 2 });

    await expect(reconciler.reconcile()).rejects.toThrow(/no healing strategy registered/i);
  });
});
