/**
 * M34 exit criterion: "A failed plan is traced from the console click to
 * the provider call in one correlated view. Wired to the existing
 * Grafana/OTel backends rather than duplicating them, per C05's
 * precedent."
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

let auditLogs: any[];
let kinds: any[];
let resources: any[];
let desiredStates: any[];
let desiredStateVersions: any[];
let jobRows: any[];
let seq = 0;
const nextId = (p: string) => `${p}-${++seq}`;

vi.mock("@kannan19302/database", () => ({
  prisma: {
    controlPlaneAuditLog: {
      findFirst: vi.fn(() => null),
      findMany: vi.fn(({ where }: any) =>
        auditLogs.filter((a) => a.correlationId === where.correlationId).sort((a, b) => a.sequenceNum - b.sequenceNum),
      ),
      create: vi.fn(({ data }: any) => {
        const row = { id: nextId("audit"), sequenceNum: auditLogs.length + 1, createdAt: new Date(), ...data };
        auditLogs.push(row);
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
      findMany: vi.fn(({ where }: any) => jobRows.filter((j) => j.correlationId === where.correlationId)),
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
import { DurableExecutorService } from "../operation-pipeline/durable-executor.service";
import { PrismaJobStateStore } from "../operation-pipeline/prisma-job-state-store";
import { ControlPlaneAuditService } from "./control-plane-audit.service";
import { InfrastructureResourceService } from "./infrastructure-resource.service";
import { ObservabilityTraceService } from "./observability-trace.service";

describe("M34 · observability — one correlated view", () => {
  let infra: InfrastructureResourceService;
  let resourcesSvc: ResourceModelService;
  let obs: ObservabilityTraceService;

  beforeEach(async () => {
    vi.clearAllMocks();
    auditLogs = [];
    kinds = [];
    resources = [];
    desiredStates = [];
    desiredStateVersions = [];
    jobRows = [];

    resourcesSvc = new ResourceModelService();
    infra = new InfrastructureResourceService(
      resourcesSvc,
      new PlanningService(resourcesSvc, new ProviderRegistryService(), new PolicyEngineService()),
      new DurableExecutorService(new PrismaJobStateStore(), new ControlPlaneAuditService()),
    );
    obs = new ObservabilityTraceService();
  });

  afterEach(() => {
    delete process.env.GRAFANA_BASE_URL;
    delete process.env.TEMPO_BASE_URL;
  });

  it("a FAILED plan is traced from the console click to the provider call in ONE correlated view", async () => {
    await resourcesSvc.registerResourceKind("k", "k");
    const resource = await resourcesSvc.createResource("k", "traced-resource", { size: "small" });

    const correlationId = "corr-abc-123";

    // The "console click": the same shape ControlPlaneAuditInterceptor
    // writes for every plane-1 mutating request.
    const audit = new ControlPlaneAuditService();
    await audit.record({
      actorId: "operator-1",
      actorRole: "provider",
      action: "InfrastructureResourceController.change",
      targetId: resource.id,
      details: { method: "POST", path: "/platform/v1/infrastructure-resources/x/change" },
      correlationId,
    });

    // The change itself fails its verify step -- the "provider call" that broke.
    await infra.changeDesiredState(resource.id, { size: "huge" }, async () => false, correlationId);

    const trace = await obs.getCorrelatedTrace(correlationId);

    // One query, one correlationId -- the console click AND the pipeline
    // step(s) it led to, in order.
    expect(trace.events.length).toBeGreaterThanOrEqual(2);
    expect(trace.events[0]!.action).toBe("InfrastructureResourceController.change");
    expect(trace.events.some((e) => e.action.startsWith("pipeline.step."))).toBe(true);

    // The failed provider call is named explicitly, not buried.
    expect(trace.failedAt).not.toBeNull();
    expect(trace.failedAt!.stepName).toBe("verify");
    expect(trace.failedAt!.error).toMatch(/Verification failed/);
  });

  it("is wired to the existing Grafana/OTel backends via configuration -- never fabricates a link with none configured", async () => {
    const correlationId = "corr-no-config";
    const trace = await obs.getCorrelatedTrace(correlationId);
    expect(trace.grafanaUrl).toBeNull();
    expect(trace.traceUrl).toBeNull();
  });

  it("builds a real Grafana deep link scoped to the correlation id when GRAFANA_BASE_URL is configured", async () => {
    process.env.GRAFANA_BASE_URL = "https://grafana.internal";
    const trace = await obs.getCorrelatedTrace("corr-xyz");
    expect(trace.grafanaUrl).toBe("https://grafana.internal/explore?correlationId=corr-xyz");
  });

  it("a correlationId with no events at all returns an empty, still well-formed trace", async () => {
    const trace = await obs.getCorrelatedTrace("corr-nothing-happened");
    expect(trace.events).toEqual([]);
    expect(trace.failedAt).toBeNull();
  });
});
