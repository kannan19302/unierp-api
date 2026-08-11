/**
 * M20 exit criterion: "A promotion blocked by its health gate rolls back
 * automatically and the rollback is the previous manifest — C27's stated
 * invariant, now executed by the pipeline rather than by hand."
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

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
      findMany: vi.fn(({ where }: any) => {
        let rows = resources.map((r) => ({ ...r, kind: kinds.find((k) => k.id === r.kindId) }));
        if (where?.kind?.name) rows = rows.filter((r) => r.kind?.name === where.kind.name);
        return rows;
      }),
      count: vi.fn(({ where }: any) => {
        let rows = resources;
        if (where?.kind?.name) rows = rows.filter((r) => kinds.find((k) => k.id === r.kindId)?.name === where.kind.name);
        return rows.length;
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
import { ReleasePromotionService } from "./release-promotion.service";

describe("M20 · environments, deployments and release binding", () => {
  let promotion: ReleasePromotionService;
  let resourcesSvc: ResourceModelService;

  beforeEach(() => {
    vi.clearAllMocks();
    kinds = [];
    resources = [];
    desiredStates = [];
    desiredStateVersions = [];
    jobRows = [];
    auditLogs = [];
    resourcesSvc = new ResourceModelService();
    promotion = new ReleasePromotionService(
      resourcesSvc,
      new PlanningService(resourcesSvc, new ProviderRegistryService(), new PolicyEngineService()),
      new DurableExecutorService(new PrismaJobStateStore(), new ControlPlaneAuditService()),
    );
  });

  it("a healthy promotion deploys the manifest and the job completes", async () => {
    const result = await promotion.promote("staging", "2026.09.0", async () => true);
    expect(result.promoted).toBe(true);
    expect(result.job.status).toBe("DONE");

    const desired = await resourcesSvc.getDesiredState(result.resourceId);
    expect((desired!.state as any).manifestVersion).toBe("2026.09.0");
  });

  it("a promotion blocked by its health gate rolls back automatically, and the rollback is the PREVIOUS manifest", async () => {
    // Establish a known-good prior manifest first.
    const first = await promotion.promote("prod", "2026.08.0", async () => true);
    expect(first.promoted).toBe(true);

    // Now promote to a bad manifest whose health gate fails.
    const second = await promotion.promote("prod", "2026.09.0-bad", async () => false);

    expect(second.promoted).toBe(false);
    expect(second.job.status).toBe("COMPENSATED");

    // The exit criterion's own words: the rollback IS the previous manifest.
    const desired = await resourcesSvc.getDesiredState(second.resourceId);
    expect((desired!.state as any).manifestVersion).toBe("2026.08.0");
  });

  it("promoting the same environment twice reuses the same resource, not a duplicate", async () => {
    const first = await promotion.promote("qa", "1.0.0", async () => true);
    const second = await promotion.promote("qa", "1.1.0", async () => true);
    expect(second.resourceId).toBe(first.resourceId);
  });
});
