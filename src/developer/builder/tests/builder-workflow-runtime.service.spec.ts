import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma, runWithTenantSession } from "@kannan19302/database";
import { Prisma, PrismaClient } from "@prisma/client";
import { BuilderWorkflowRuntimeService } from "../builder-workflow-runtime.service";

/**
 * G11 exit criterion: "A flow with a failing external call compensates
 * correctly and is resumable. Every flow run is inspectable step by step."
 *
 * The runtime is constructed with an injectable HTTP client so a webhook can
 * be forced to fail deterministically: charge succeeds and declares a
 * compensation handler, ship fails on the first attempt, resume re-runs from
 * the failing step and completes.
 *
 * Runs/steps are written through the owner connection but asserted over the
 * unerp_api (NOBYPASSRLS) role, exactly as CustomObjectSchemaService's spec
 * does — RLS is the tenant boundary, and a check that bypasses it proves
 * nothing.
 */
describe("BuilderWorkflowRuntimeService", () => {
  const tenantA = "spec-tenant-g11-a";
  const tenantB = "spec-tenant-g11-b";
  let workflowId: string;
  let workflowBId: string;

  const makeHttp = (failUrls: string[]) => async (
    url: string,
    init?: { method?: string },
  ) => {
    if (failUrls.includes(url)) {
      return { ok: false, status: 500, text: async () => "boom", json: async () => ({}) };
    }
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ url }),
      json: async () => ({ url, ok: true }),
    };
  };

  const wfNodes = (): any[] => [
    { id: "n-trigger", type: "input", data: { nodeType: "trigger", label: "Trigger: Manual" } },
    {
      id: "n-charge",
      type: "custom",
      data: {
        nodeType: "webhook",
        label: "Charge",
        config: {
          url: "https://pay.example/charge",
          method: "POST",
          compensate: { url: "https://pay.example/refund", method: "POST" },
        },
      },
    },
    {
      id: "n-ship",
      type: "custom",
      data: { nodeType: "webhook", label: "Ship", config: { url: "https://ship.example/ship", method: "POST" } },
    },
  ];
  const wfEdges = (): any[] => [
    { id: "e1", source: "n-trigger", target: "n-charge" },
    { id: "e2", source: "n-charge", target: "n-ship" },
  ];

  beforeAll(async () => {
    const wf = await prisma.builderWorkflow.create({
      data: { tenantId: tenantA, name: "G11 exit criterion", nodes: wfNodes(), edges: wfEdges() },
    });
    workflowId = wf.id;
    const wfB = await prisma.builderWorkflow.create({
      data: { tenantId: tenantB, name: "G11 other tenant", nodes: wfNodes(), edges: wfEdges() },
    });
    workflowBId = wfB.id;
  });

  afterAll(async () => {
    await prisma.builderWorkflowRun.deleteMany({ where: { workflowId: { in: [workflowId, workflowBId] } } });
    await prisma.builderWorkflow.deleteMany({ where: { id: { in: [workflowId, workflowBId] } } });
  });

  it("records every step in order — the run is inspectable step by step", async () => {
    const service = new BuilderWorkflowRuntimeService(makeHttp([]));
    const run = await service.executeWorkflow(tenantA, workflowId, { trigger: "MANUAL" });

    expect(run.status).toBe("COMPLETED");
    expect(run.steps.length).toBe(3);
    const types = run.steps.map((s) => s.nodeType);
    expect(types).toEqual(["trigger", "webhook", "webhook"]);
    run.steps.forEach((s, i) => {
      expect(s.sortOrder).toBe(i);
      expect(s.status).toBe("SUCCESS");
    });
  });

  it("compensates the previously-successful charge step when the external ship call fails, and is resumable", async () => {
    // First attempt: ship fails.
    const failing = new BuilderWorkflowRuntimeService(makeHttp(["https://ship.example/ship"]));
    const run = await failing.executeWorkflow(tenantA, workflowId, { trigger: "MANUAL" });

    expect(run.status).toBe("FAILED");
    expect(run.resumeFrom).toBe("n-ship");
    expect(run.error).toContain("HTTP 500");

    const steps = await serviceRunSteps(run.id);
    const charge = steps.find((s) => s.nodeId === "n-charge");
    const ship = steps.find((s) => s.nodeId === "n-ship");
    // The charge step was compensated (refund webhook called).
    expect(charge?.status).toBe("COMPENSATED");
    expect((charge?.output as any)?.compensated).toBe(true);
    expect((charge?.output as any)?.target).toBe("https://pay.example/refund");
    expect(ship?.status).toBe("FAILED");
  });

  it("resumes a failed run from the failing step and completes", async () => {
    const failing = new BuilderWorkflowRuntimeService(makeHttp(["https://ship.example/ship"]));
    const run = await failing.executeWorkflow(tenantA, workflowId, { trigger: "MANUAL" });
    expect(run.status).toBe("FAILED");

    // Second attempt: everything succeeds.
    const healthy = new BuilderWorkflowRuntimeService(makeHttp([]));
    const resumed = await healthy.resumeWorkflow(tenantA, run.id);
    expect(resumed.status).toBe("COMPLETED");

    const steps = await serviceRunSteps(run.id);
    const shipSteps = steps.filter((s) => s.nodeId === "n-ship");
    // First ship attempt FAILED, resume re-ran it to SUCCESS.
    expect(shipSteps[0].status).toBe("FAILED");
    expect(shipSteps[shipSteps.length - 1].status).toBe("SUCCESS");
  });

  it("branches on a condition node: true and false paths are followed separately", async () => {
    const condNodes = (): any[] => [
      { id: "n-trigger", type: "input", data: { nodeType: "trigger", label: "Trigger" } },
      {
        id: "n-cond",
        type: "custom",
        data: { nodeType: "condition", label: "Amount?", config: { field: "amount", operator: ">", value: 500 } },
      },
      {
        id: "n-true",
        type: "custom",
        data: { nodeType: "webhook", label: "High", config: { url: "https://app.example/high", method: "POST" } },
      },
      {
        id: "n-false",
        type: "custom",
        data: { nodeType: "webhook", label: "Low", config: { url: "https://app.example/low", method: "POST" } },
      },
    ];
    const condEdges = (): any[] => [
      { id: "c1", source: "n-trigger", target: "n-cond" },
      { id: "c2", source: "n-cond", target: "n-true" },
      { id: "c3", source: "n-cond", target: "n-false" },
    ];
    const wf = await prisma.builderWorkflow.create({
      data: { tenantId: tenantA, name: "G11 branch", nodes: condNodes(), edges: condEdges() },
    });
    try {
      const service = new BuilderWorkflowRuntimeService(makeHttp([]));
      const runTrue = await service.executeWorkflow(tenantA, wf.id, { input: { amount: 1500 } });
      const trueSteps = runTrue.steps.map((s) => s.nodeId);
      expect(trueSteps).toContain("n-true");
      expect(trueSteps).not.toContain("n-false");

      const runFalse = await service.executeWorkflow(tenantA, wf.id, { input: { amount: 100 } });
      const falseSteps = runFalse.steps.map((s) => s.nodeId);
      expect(falseSteps).toContain("n-false");
      expect(falseSteps).not.toContain("n-true");
    } finally {
      await prisma.builderWorkflowRun.deleteMany({ where: { workflowId: wf.id } });
      await prisma.builderWorkflow.delete({ where: { id: wf.id } });
    }
  });

  it("isolates runs between tenants at the database level (unerp_api, NOBYPASSRLS)", async () => {
    const appUrl =
      process.env.DATABASE_APP_URL ??
      appRoleUrlFrom(process.env.DATABASE_URL);
    const appClient = new PrismaClient({ datasources: { db: { url: appUrl } } });
    try {
      const [role] = await appClient.$queryRaw<
        Array<{ rolname: string; rolbypassrls: boolean }>
      >(Prisma.sql`SELECT rolname, rolbypassrls FROM pg_roles WHERE rolname = current_user`);
      expect(role?.rolname).toBe("unerp_api");
      expect(role?.rolbypassrls).toBe(false);

      const service = new BuilderWorkflowRuntimeService(makeHttp([]));
      await service.executeWorkflow(tenantA, workflowId, { trigger: "MANUAL" });
      await service.executeWorkflow(tenantB, workflowBId, { trigger: "MANUAL" });

      const seenByA = await appClient.$transaction(async (tx) => {
        await tx.$executeRaw(
          Prisma.sql`SELECT set_config('app.current_tenant_id', ${tenantA}, true)`,
        );
        return tx.$queryRaw<Array<{ workflow_id: string }>>(
          Prisma.sql`SELECT "workflow_id" FROM "builder_workflow_runs"`,
        );
      });
      const seenIds = seenByA.map((r) => r.workflow_id);
      expect(seenIds).toContain(workflowId);
      expect(seenIds).not.toContain(workflowBId);
    } finally {
      await appClient.$disconnect();
    }
  });
});

function appRoleUrlFrom(ownerUrl: string | undefined): string {
  const url = new URL(
    ownerUrl ?? "postgresql://unerp:unerp_password@localhost:5432/unerp_dev",
  );
  url.username = "unerp_api";
  url.password = "unerp_api_password";
  url.searchParams.set("schema", "public");
  url.searchParams.set("connection_limit", "2");
  url.searchParams.set("pool_timeout", "20");
  return url.toString();
}

async function serviceRunSteps(runId: string) {
  return prisma.builderWorkflowRunStep.findMany({
    where: { runId },
    orderBy: { sortOrder: "asc" },
  });
}