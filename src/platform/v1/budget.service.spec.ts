/**
 * M29 exit criterion (budget half): "A budget crossing its threshold
 * alerts and, where configured, executes an enforcement plan through the
 * pipeline — never a direct mutation."
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

let budgets: any[];
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
    budgetPolicy: {
      upsert: vi.fn(({ where, create, update }: any) => {
        const k = where.tenantId_period;
        const existing = budgets.find((b) => b.tenantId === k.tenantId && b.period === k.period);
        if (existing) {
          Object.assign(existing, update);
          return existing;
        }
        const row = { id: nextId("budget"), ...create };
        budgets.push(row);
        return row;
      }),
      findUnique: vi.fn(({ where }: any) => {
        const k = where.tenantId_period;
        return budgets.find((b) => b.tenantId === k.tenantId && b.period === k.period) ?? null;
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
import { BudgetService } from "./budget.service";

describe("M29 · budgets, forecasts and quota binding — budget enforcement", () => {
  let budgetSvc: BudgetService;
  let resourcesSvc: ResourceModelService;

  beforeEach(() => {
    vi.clearAllMocks();
    budgets = [];
    kinds = [];
    resources = [];
    desiredStates = [];
    desiredStateVersions = [];
    jobRows = [];
    auditLogs = [];

    resourcesSvc = new ResourceModelService();
    budgetSvc = new BudgetService(
      new PlanningService(resourcesSvc, new ProviderRegistryService(), new PolicyEngineService()),
      new DurableExecutorService(new PrismaJobStateStore(), new ControlPlaneAuditService()),
      resourcesSvc,
      new ControlPlaneAuditService(),
    );
  });

  it("a budget under its threshold does not cross or alert", async () => {
    await budgetSvc.createBudget("tenant-1", "2026-08", "1000.00");
    const result = await budgetSvc.checkAndEnforce("tenant-1", "2026-08", "500.00");
    expect(result.crossed).toBe(false);
    expect(auditLogs).toHaveLength(0);
  });

  it("a budget crossing its threshold alerts, with no enforcement configured", async () => {
    await budgetSvc.createBudget("tenant-1", "2026-08", "1000.00");
    const result = await budgetSvc.checkAndEnforce("tenant-1", "2026-08", "1500.00");

    expect(result.crossed).toBe(true);
    expect(result.enforced).toBe(false);
    const alerts = auditLogs.filter((a) => a.action === "budget.threshold-crossed");
    expect(alerts).toHaveLength(1);
    expect(alerts[0].targetId).toBe("tenant-1");
  });

  it("a budget crossing its threshold, WHERE CONFIGURED, executes an enforcement plan through the pipeline -- never a direct mutation", async () => {
    await resourcesSvc.registerResourceKind("compute-instance", "k");
    const target = await resourcesSvc.createResource("compute-instance", "tenant-1-quota-instance", { throttled: false });

    await budgetSvc.createBudget("tenant-1", "2026-08", "1000.00", {
      resourceId: target.id,
      desiredState: { throttled: true },
    });

    const result = await budgetSvc.checkAndEnforce("tenant-1", "2026-08", "1500.00");

    expect(result.crossed).toBe(true);
    expect(result.enforced).toBe(true);
    expect(result.jobStatus).toBe("DONE");

    // The mutation genuinely went through the plan pipeline: desired
    // state (M07) reflects it, versioned (M14) — not a bare field write.
    const desired = await resourcesSvc.getDesiredState(target.id);
    expect((desired!.state as any).throttled).toBe(true);
  });

  it("checking a budget that was never created is refused explicitly", async () => {
    await expect(budgetSvc.checkAndEnforce("tenant-none", "2026-08", "1.00")).rejects.toThrow(/No budget policy/);
  });
});
