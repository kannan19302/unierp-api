/**
 * M31 exit criterion: "Every recommendation is executable as a plan and
 * states its saving from M25's real prices. A recommendation acted upon
 * is measured afterwards against its predicted saving, and the
 * difference is shown. No recommendation is advice-only."
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

let lineItems: any[];
let recommendations: any[];
let kinds: any[];
let resources: any[];
let desiredStates: any[];
let desiredStateVersions: any[];
let jobRows: any[];
let auditLogs: any[];
let seq = 0;
const nextId = (p: string) => `${p}-${++seq}`;

vi.mock("@kannan19302/database", () => ({
  prisma: {
    costLineItem: {
      findMany: vi.fn(({ where }: any) => lineItems.filter((li) => li.resourceId === where.resourceId)),
    },
    finOpsRecommendation: {
      create: vi.fn(({ data }: any) => {
        const row = { id: nextId("rec"), createdAt: new Date(), executedAt: null, actualCostAfter: null, actualSaving: null, variance: null, ...data };
        recommendations.push(row);
        return row;
      }),
      findUnique: vi.fn(({ where: { id } }: any) => recommendations.find((r) => r.id === id) ?? null),
      update: vi.fn(({ where: { id }, data }: any) => {
        const row = recommendations.find((r) => r.id === id)!;
        Object.assign(row, data);
        return row;
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
import { FinOpsRecommendationService } from "./finops-recommendation.service";

describe("M31 · FinOps optimisation and waste recovery", () => {
  let finops: FinOpsRecommendationService;
  let resourcesSvc: ResourceModelService;

  beforeEach(() => {
    vi.clearAllMocks();
    lineItems = [];
    recommendations = [];
    kinds = [];
    resources = [];
    desiredStates = [];
    desiredStateVersions = [];
    jobRows = [];
    auditLogs = [];

    resourcesSvc = new ResourceModelService();
    finops = new FinOpsRecommendationService(
      resourcesSvc,
      new PlanningService(resourcesSvc, new ProviderRegistryService(), new PolicyEngineService()),
      new DurableExecutorService(new PrismaJobStateStore(), new ControlPlaneAuditService()),
    );
  });

  it("a recommendation states its saving from M25's REAL prices, never a made-up number", async () => {
    lineItems.push(
      { resourceId: "res-idle", amount: { toString: () => "80.0000" } },
      { resourceId: "res-idle", amount: { toString: () => "20.0000" } },
    );

    const rec = await finops.generateRecommendation("res-idle", "IDLE", 0.5, { instanceType: "t3.nano" });

    expect(rec.costBefore).toBe("100.0000"); // summed from the REAL line items above
    expect(rec.predictedSaving).toBe("50.0000"); // 50% of the real cost
    expect(rec.status).toBe("PENDING");
  });

  it("no recommendation is advice-only — one without a recommendedDesiredState is refused outright", async () => {
    await expect(finops.generateRecommendation("res-x", "IDLE", 0.5, {})).rejects.toThrow(/recommendedDesiredState/);
  });

  it("every recommendation is EXECUTABLE AS A PLAN — running it goes through the real pipeline and changes desired state", async () => {
    await resourcesSvc.registerResourceKind("k", "k");
    const resource = await resourcesSvc.createResource("k", "over-provisioned-db", { instanceType: "db.r5.4xlarge" });
    lineItems.push({ resourceId: resource.id, amount: { toString: () => "500.0000" } });

    const rec = await finops.generateRecommendation(resource.id, "OVER_PROVISIONED", 0.3, { instanceType: "db.r5.large" });
    const result = await finops.executeRecommendation(rec.id);

    expect(result.jobStatus).toBe("DONE");
    const desired = await resourcesSvc.getDesiredState(resource.id);
    expect((desired!.state as any).instanceType).toBe("db.r5.large");

    const updated = recommendations.find((r) => r.id === rec.id);
    expect(updated.status).toBe("EXECUTED");
    expect(updated.executedAt).not.toBeNull();
  });

  it("a recommendation acted upon is MEASURED afterwards against its predicted saving, and the DIFFERENCE is shown", async () => {
    await resourcesSvc.registerResourceKind("k", "k");
    const resource = await resourcesSvc.createResource("k", "underperforming-savings", { size: "large" });
    lineItems.push({ resourceId: resource.id, amount: { toString: () => "200.0000" } });

    const rec = await finops.generateRecommendation(resource.id, "OVER_PROVISIONED", 0.5, { size: "small" }); // predicted saving 100.00
    await finops.executeRecommendation(rec.id);

    // Reality: the actual cost afterward only dropped to 150 (saved 50,
    // not the predicted 100) -- the recommendation under-delivered.
    const measured = await finops.measureActualSaving(rec.id, "150.0000");

    expect(measured.actualSaving).toBe("50.0000");
    expect(measured.variance).toBe("-50.0000"); // 50 actual - 100 predicted = -50 shortfall, SHOWN not hidden
  });

  it("measuring a recommendation that was never executed is refused -- nothing to measure yet", async () => {
    lineItems.push({ resourceId: "res-y", amount: { toString: () => "10.0000" } });
    const rec = await finops.generateRecommendation("res-y", "IDLE", 0.5, { deprovision: true });
    await expect(finops.measureActualSaving(rec.id, "5.00")).rejects.toThrow(/has not been executed yet/);
  });
});
