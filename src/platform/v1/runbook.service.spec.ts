/**
 * M45 exit criterion: "A runbook is authored, dry-run, approved and
 * executed from an incident, and its execution is audited as a plan. A
 * runbook that would breach M08 policy cannot be published."
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

let kinds: any[];
let resources: any[];
let desiredStates: any[];
let desiredStateVersions: any[];
let runbooks: any[];
let runbookExecutions: any[];
let incidents: any[];
let policies: any[];
let overrides: any[];
let controlPlaneApprovals: any[];
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
      create: vi.fn(({ data }: any) => { const row = { id: nextId("res"), createdAt: new Date(), ...data }; resources.push(row); return row; }),
      findUnique: vi.fn(({ where: { id } }: any) => resources.find((r) => r.id === id) ?? null),
    },
    desiredState: {
      upsert: vi.fn(({ where: { resourceId }, create, update }: any) => {
        const existing = desiredStates.find((d) => d.resourceId === resourceId);
        if (existing) { Object.assign(existing, update); return existing; }
        const row = { id: nextId("ds"), ...create };
        desiredStates.push(row);
        return row;
      }),
      findUnique: vi.fn(({ where: { resourceId } }: any) => desiredStates.find((d) => d.resourceId === resourceId) ?? null),
    },
    desiredStateVersion: { create: vi.fn(({ data }: any) => { const row = { id: nextId("dsv"), setAt: new Date(), ...data }; desiredStateVersions.push(row); return row; }) },
    dependency: { findMany: vi.fn(() => []) },
    runbook: {
      create: vi.fn(({ data }: any) => { const row = { id: nextId("rb"), version: 1, createdAt: new Date(), ...data }; runbooks.push(row); return row; }),
      findUnique: vi.fn(({ where: { id } }: any) => runbooks.find((r) => r.id === id) ?? null),
      update: vi.fn(({ where: { id }, data }: any) => { const row = runbooks.find((r) => r.id === id)!; Object.assign(row, data); return row; }),
    },
    runbookExecution: {
      create: vi.fn(({ data }: any) => { const row = { id: nextId("rbex"), executedAt: new Date(), ...data }; runbookExecutions.push(row); return row; }),
    },
    incident: {
      findUnique: vi.fn(({ where: { id } }: any) => incidents.find((i) => i.id === id) ?? null),
    },
    policy: {
      findUnique: vi.fn(({ where: { name } }: any) => policies.find((p) => p.name === name) ?? null),
      upsert: vi.fn(({ where: { name }, create, update }: any) => {
        const existing = policies.find((p) => p.name === name);
        if (existing) { Object.assign(existing, update); return existing; }
        const row = { id: nextId("pol"), ...create };
        policies.push(row);
        return row;
      }),
    },
    policyOverride: { findFirst: vi.fn(() => null) },
    controlPlaneApproval: {
      create: vi.fn(({ data }: any) => { const row = { id: nextId("appr"), ...data }; controlPlaneApprovals.push(row); return row; }),
      findUnique: vi.fn(({ where: { id } }: any) => controlPlaneApprovals.find((a) => a.id === id) ?? null),
      update: vi.fn(({ where: { id }, data }: any) => { const row = controlPlaneApprovals.find((a) => a.id === id)!; Object.assign(row, data); return row; }),
    },
    job: {
      create: vi.fn(({ data }: any) => { const row = { ...data }; jobRows.push(row); return row; }),
      findUnique: vi.fn(({ where: { id } }: any) => jobRows.find((j) => j.id === id) ?? null),
      update: vi.fn(({ where: { id }, data }: any) => { const row = jobRows.find((j) => j.id === id)!; Object.assign(row, data); return row; }),
    },
    controlPlaneAuditLog: {
      findFirst: vi.fn(() => null),
      create: vi.fn(({ data }: any) => { const row = { id: nextId("audit"), ...data }; auditLogs.push(row); return row; }),
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
import { ControlPlaneApprovalsService } from "./control-plane-approvals.service";
import { RunbookService } from "./runbook.service";

describe("M45 · runbooks — authored, dry-run, approved and executed from an incident, audited as a plan", () => {
  let runbooksSvc: RunbookService;
  let resourcesSvc: ResourceModelService;
  let policyEngine: PolicyEngineService;

  beforeEach(async () => {
    vi.clearAllMocks();
    kinds = []; resources = []; desiredStates = []; desiredStateVersions = [];
    runbooks = []; runbookExecutions = []; incidents = []; policies = []; overrides = [];
    controlPlaneApprovals = []; jobRows = []; auditLogs = [];

    resourcesSvc = new ResourceModelService();
    policyEngine = new PolicyEngineService();
    const planning = new PlanningService(resourcesSvc, new ProviderRegistryService(), policyEngine);
    const executor = new DurableExecutorService(new PrismaJobStateStore(), new ControlPlaneAuditService());
    const approvals = new ControlPlaneApprovalsService(new ControlPlaneAuditService());
    runbooksSvc = new RunbookService(resourcesSvc, planning, policyEngine, executor, approvals);

    await resourcesSvc.registerResourceKind("test-target");
    await policyEngine.registerPolicy("no-destroy", "refuses a destroy proposal", (change) =>
      change.action === "destroy" ? { allowed: false, violation: { rule: "no-destroy", field: "action", reason: "destroy is never allowed via runbook" } } : { allowed: true },
    );
  });

  async function makeResource() {
    return resourcesSvc.createResource("test-target", "target-1", { replicas: 1 });
  }

  it("AUTHORS a runbook as DRAFT", async () => {
    const resource = await makeResource();
    const runbook = await runbooksSvc.authorRunbook("scale-up", [{ resourceId: resource.id, proposedState: { replicas: 3 } }]);
    expect(runbook.status).toBe("DRAFT");
  });

  it("DRY-RUNS with no side effect — desired state is unchanged after", async () => {
    const resource = await makeResource();
    const runbook = await runbooksSvc.authorRunbook("scale-up", [{ resourceId: resource.id, proposedState: { replicas: 3 } }]);

    const plans = await runbooksSvc.dryRunRunbook(runbook.id);
    expect(plans).toHaveLength(1);

    const desired = await resourcesSvc.getDesiredState(resource.id);
    expect((desired!.state as any).replicas).toBe(1); // unchanged by the dry run
  });

  it("PUBLISHES a runbook whose steps clear M08 policy", async () => {
    const resource = await makeResource();
    const runbook = await runbooksSvc.authorRunbook("scale-up", [{ resourceId: resource.id, proposedState: { replicas: 3 } }]);

    const published = await runbooksSvc.publishRunbook(runbook.id, "no-destroy");
    expect(published.status).toBe("PUBLISHED");
  });

  it("REFUSES to publish a runbook that would breach M08 policy — never reaches PUBLISHED", async () => {
    const resource = await makeResource();
    const runbook = await runbooksSvc.authorRunbook("destroy-target", [{ resourceId: resource.id, proposedState: { action: "destroy" } }]);

    await expect(runbooksSvc.publishRunbook(runbook.id, "no-destroy")).rejects.toThrow(/breaches policy/);
    const reread = await runbooksSvc.dryRunRunbook(runbook.id); // still readable/dry-runnable
    expect(reread).toHaveLength(1);
    expect(runbooks.find((r) => r.id === runbook.id)!.status).toBe("DRAFT"); // never published
  });

  it("EXECUTES a published runbook from a real incident, through a real two-person approval, as a real M12 job — the audit spine gains records", async () => {
    const resource = await makeResource();
    const runbook = await runbooksSvc.authorRunbook("scale-up", [{ resourceId: resource.id, proposedState: { replicas: 5 } }]);
    await runbooksSvc.publishRunbook(runbook.id, "no-destroy");
    incidents.push({ id: "inc-1" });

    const auditCountBefore = auditLogs.length;
    const { execution, job } = await runbooksSvc.executeFromIncident(runbook.id, "inc-1", "operator-a", "operator-b");

    expect(job.status).toBe("DONE");
    expect(execution.incidentId).toBe("inc-1");
    expect(execution.jobId).toBe(job.id);
    expect(auditLogs.length).toBeGreaterThan(auditCountBefore); // executed AS A PLAN — the pipeline's own audit gate fired

    const desired = await resourcesSvc.getDesiredState(resource.id);
    expect((desired!.state as any).replicas).toBe(5); // the actual mutation, only via the plan pipeline
  });

  it("REFUSES to execute an unpublished (DRAFT) runbook, even from a real incident", async () => {
    const resource = await makeResource();
    const runbook = await runbooksSvc.authorRunbook("scale-up", [{ resourceId: resource.id, proposedState: { replicas: 5 } }]);
    incidents.push({ id: "inc-2" });

    await expect(runbooksSvc.executeFromIncident(runbook.id, "inc-2", "operator-a", "operator-b")).rejects.toThrow(/not PUBLISHED/);
  });

  it("REFUSES a same-operator approval — two-person control is enforced, not bypassed for runbooks", async () => {
    const resource = await makeResource();
    const runbook = await runbooksSvc.authorRunbook("scale-up", [{ resourceId: resource.id, proposedState: { replicas: 5 } }]);
    await runbooksSvc.publishRunbook(runbook.id, "no-destroy");
    incidents.push({ id: "inc-3" });

    await expect(runbooksSvc.executeFromIncident(runbook.id, "inc-3", "operator-a", "operator-a")).rejects.toThrow();
  });
});
