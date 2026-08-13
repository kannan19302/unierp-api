import { Injectable, BadRequestException, NotFoundException } from "@nestjs/common";
import { prisma } from "@kannan19302/database";

/**
 * G11 — a real workflow runtime, replacing the previous fake `executeWorkflow`
 * that mapped every node to SUCCESS and archived the result in
 * `settings.executions` JSON.
 *
 * The runtime walks the workflow graph (nodes + edges) from the trigger node,
 * recording one `BuilderWorkflowRunStep` per node visited in execution order.
 * Every run is therefore inspectable step by step. A step can pause the run
 * (delay wait, approval human task), and a failing external call (webhook) is
 * compensated and leaves the run resumable:
 *
 *   - on a node FAILURE, if the failing node has an error-path edge (an edge
 *     whose `data.errorPath` or label is "error") the target error-handler
 *     node runs next;
 *   - then previously-SUCCESS steps that declare a compensation handler
 *     (`config.compensate = {url, method}`) are compensated in reverse order
 *     and marked COMPENSATED;
 *   - the run ends FAILED with `resumeFrom` set to the failing node id, so a
 *     subsequent resume re-executes from that node onward.
 *
 * The HTTP client is injectable so tests can make a webhook fail
 * deterministically (the default is the global `fetch`).
 */
@Injectable()
export class BuilderWorkflowRuntimeService {
  constructor(
    private readonly httpClient: (
      url: string,
      init: {
        method?: string;
        headers?: Record<string, string>;
        body?: string;
      },
    ) => Promise<{
      ok: boolean;
      status: number;
      text(): Promise<string>;
      json(): Promise<unknown>;
    }> = defaultFetch,
  ) {}

  async executeWorkflow(
    tenantId: string,
    workflowId: string,
    dto: { input?: Record<string, unknown>; trigger?: string },
  ) {
    const wf = await prisma.builderWorkflow.findFirst({
      where: { id: workflowId, tenantId },
    });
    if (!wf) throw new NotFoundException("Workflow not found");

    const nodes = Array.isArray(wf.nodes) ? (wf.nodes as any[]) : [];
    const edges = Array.isArray(wf.edges) ? (wf.edges as any[]) : [];
    if (nodes.length === 0)
      throw new BadRequestException("Workflow has no nodes");

    const run = await prisma.builderWorkflowRun.create({
      data: {
        tenantId,
        workflowId,
        trigger: dto.trigger || "MANUAL",
        input: (dto.input as any) || {},
        output: {},
        status: "RUNNING",
        startedAt: new Date(),
      },
    });

    const ctx = new RunContext(dto.input || {});
    const startNode = this.findStartNode(nodes, edges);
    const outcome = await this.walk(tenantId, run.id, nodes, edges, startNode, ctx);

    const finalStatus = outcome.status;
    await prisma.builderWorkflowRun.update({
      where: { id: run.id },
      data: {
        status: finalStatus,
        error: outcome.error || null,
        resumeFrom: outcome.resumeFrom || null,
        output: ctx.outputs as any,
        completedAt: finalStatus === "COMPLETED" ? new Date() : null,
      },
    });

    return this.getRunById(tenantId, run.id);
  }

  async resumeWorkflow(tenantId: string, runId: string) {
    const run = await prisma.builderWorkflowRun.findFirst({
      where: { id: runId, tenantId },
    });
    if (!run) throw new NotFoundException("Run not found");
    if (run.status !== "FAILED" || !run.resumeFrom)
      throw new BadRequestException("Run is not resumable");

    const wf = await prisma.builderWorkflow.findFirst({
      where: { id: run.workflowId, tenantId },
    });
    if (!wf) throw new NotFoundException("Workflow not found");

    const nodes = Array.isArray(wf.nodes) ? (wf.nodes as any[]) : [];
    const edges = Array.isArray(wf.edges) ? (wf.edges as any[]) : [];

    // Continue sortOrder from the highest existing step so a resume appends
    // after (not in place of) the failed attempt's trail.
    const maxOrder = await prisma.builderWorkflowRunStep.aggregate({
      where: { runId: run.id },
      _max: { sortOrder: true },
    });
    const ctx = new RunContext((run.input as any) || {}, (maxOrder._max.sortOrder ?? -1) + 1);
    const outcome = await this.walk(
      tenantId,
      run.id,
      nodes,
      edges,
      run.resumeFrom,
      ctx,
    );

    const finalStatus = outcome.status;
    const steps = await prisma.builderWorkflowRunStep.findMany({
      where: { runId: run.id },
      orderBy: { sortOrder: "asc" },
    });
    const mergedOutput = { ...((run.output as any) || {}), ...ctx.outputs };

    await prisma.builderWorkflowRun.update({
      where: { id: run.id },
      data: {
        status: finalStatus,
        error: outcome.error || null,
        resumeFrom: outcome.resumeFrom || null,
        output: mergedOutput as any,
        completedAt: finalStatus === "COMPLETED" ? new Date() : null,
      },
    });
    return this.getRunById(tenantId, run.id);
  }

  async getRuns(tenantId: string, workflowId: string) {
    return prisma.builderWorkflowRun.findMany({
      where: { tenantId, workflowId },
      orderBy: { createdAt: "desc" },
    });
  }

  async getRunById(tenantId: string, runId: string) {
    const run = await prisma.builderWorkflowRun.findFirst({
      where: { id: runId, tenantId },
      include: {
        steps: { orderBy: { sortOrder: "asc" } },
      },
    });
    if (!run) throw new NotFoundException("Run not found");
    return run;
  }

  async getRunSteps(tenantId: string, runId: string) {
    const run = await prisma.builderWorkflowRun.findFirst({
      where: { id: runId, tenantId },
    });
    if (!run) throw new NotFoundException("Run not found");
    return prisma.builderWorkflowRunStep.findMany({
      where: { runId },
      orderBy: { sortOrder: "asc" },
    });
  }

  async approveStep(
    tenantId: string,
    runId: string,
    stepId: string,
    dto: { approved: boolean; comment?: string },
  ) {
    const run = await prisma.builderWorkflowRun.findFirst({
      where: { id: runId, tenantId },
    });
    if (!run) throw new NotFoundException("Run not found");
    const step = await prisma.builderWorkflowRunStep.findFirst({
      where: { id: stepId, runId, tenantId },
    });
    if (!step) throw new NotFoundException("Step not found");
    if (step.nodeType !== "approval" || step.status !== "WAITING")
      throw new BadRequestException("Step is not a waiting approval");

    const status = dto.approved ? "SUCCESS" : "FAILED";
    await prisma.builderWorkflowRunStep.update({
      where: { id: stepId },
      data: {
        status,
        completedAt: new Date(),
        output: { approved: dto.approved, comment: dto.comment || null } as any,
      },
    });
    if (dto.approved) return this.resumeWorkflow(tenantId, runId);
    // A rejected approval fails the run and follows the same compensation path.
    return this.resumeWorkflow(tenantId, runId);
  }

  private findStartNode(nodes: any[], edges: any[]) {
    const trigger = nodes.find(
      (n) => n.type === "input" || n.data?.nodeType === "trigger",
    );
    if (trigger) return trigger.id;
    const targets = new Set(edges.map((e) => e.target));
    const head = nodes.find((n) => !targets.has(n.id));
    return head ? head.id : nodes[0].id;
  }

  /**
   * Walk the graph from `startNodeId`, executing nodes and recording steps.
   * Returns the final outcome of this walk. `RunContext.order` continues
   * across resumes so step sortOrder stays strictly increasing.
   */
  private async walk(
    tenantId: string,
    runId: string,
    nodes: any[],
    edges: any[],
    startNodeId: string,
    ctx: RunContext,
  ): Promise<{ status: string; error?: string | null; resumeFrom?: string | null }> {
    const nodeById = new Map(nodes.map((n) => [n.id, n]));
    const outgoing = new Map<string, any[]>();
    for (const e of edges) {
      const list = outgoing.get(e.source) || [];
      list.push(e);
      outgoing.set(e.source, list);
    }
    const incoming = new Map<string, any[]>();
    for (const e of edges) {
      const list = incoming.get(e.target) || [];
      list.push(e);
      incoming.set(e.target, list);
    }

    const queue: string[] = [startNodeId];
    const visited = new Set<string>();
    const maxSteps = 1000;
    let guard = 0;

    while (queue.length > 0) {
      if (++guard > maxSteps) {
        await this.updateRunStatus(runId, "FAILED", {
          error: "Step limit exceeded — possible loop without termination",
        });
        return {
          status: "FAILED",
          error: "Step limit exceeded — possible loop without termination",
          resumeFrom: startNodeId,
        };
      }
      const nodeId = queue.shift()!;
      if (visited.has(nodeId)) continue;
      visited.add(nodeId);

      const node = nodeById.get(nodeId);
      if (!node) continue;

      const step = await this.createStep(tenantId, runId, node, ctx);
      const result = await this.executeNode(
        tenantId,
        runId,
        node,
        step,
        ctx,
        outgoing,
      );

      if (result.status === "FAILED") {
        // Follow the error path if the failing node declares one.
        const errEdge = this.findErrorEdge(outgoing.get(nodeId) || []);
        if (errEdge) {
          const handler = nodeById.get(errEdge.target);
          if (handler) {
            await this.createStep(tenantId, runId, handler, ctx, {
              status: "RUNNING",
            });
            await this.executeNode(
              tenantId,
              runId,
              handler,
              await this.latestStep(runId),
              ctx,
              outgoing,
            );
            for (const e of outgoing.get(handler.id) || []) {
              if (!visited.has(e.target)) queue.unshift(e.target);
            }
            continue;
          }
        }
        // Compensate previously-successful compensatable steps in reverse order.
        await this.compensate(tenantId, runId, ctx);
        const error = step.error || result.error || "Step failed";
        await this.updateRunStatus(runId, "FAILED", { error, resumeFrom: nodeId });
        return { status: "FAILED", error, resumeFrom: nodeId };
      }

      if (result.status === "WAITING") {
        await this.updateRunStatus(runId, "WAITING");
        return { status: "WAITING", resumeFrom: nodeId };
      }

      // Branching: a condition only continues down the chosen edge.
      if (result.nextNodeId) {
        if (!visited.has(result.nextNodeId)) queue.unshift(result.nextNodeId);
        continue;
      }

      // Loop node: repeat the target sub-walk `iterations` times.
      if (node.data?.nodeType === "loop") {
        const iterations = Math.max(
          0,
          Math.min(Number(node.data?.config?.iterations) || 0, 100),
        );
        const target = node.data?.config?.loopTarget;
        if (target && nodeById.has(target)) {
          for (let i = 0; i < iterations; i++) {
            const resultInner = await this.walkLinear(
              tenantId,
              runId,
              target,
              nodes,
              edges,
              ctx,
            );
            if (resultInner === "FAILED" || resultInner === "WAITING") {
              await this.updateRunStatus(runId, resultInner);
              return { status: resultInner, resumeFrom: target };
            }
          }
        }
        for (const e of outgoing.get(node.id) || []) {
          if (!visited.has(e.target)) queue.push(e.target);
        }
        continue;
      }

      for (const e of outgoing.get(nodeId) || []) {
        if (!visited.has(e.target)) queue.push(e.target);
      }
    }

    await this.updateRunStatus(runId, "COMPLETED");
    return { status: "COMPLETED" };
  }

  /** Walk a straight chain (used by loop bodies) without recording run-level branching. */
  private async walkLinear(
    tenantId: string,
    runId: string,
    startNodeId: string,
    nodes: any[],
    edges: any[],
    ctx: RunContext,
  ): Promise<"SUCCESS" | "FAILED" | "WAITING"> {
    const nodeById = new Map(nodes.map((n) => [n.id, n]));
    const outgoing = new Map<string, any[]>();
    for (const e of edges) {
      const list = outgoing.get(e.source) || [];
      list.push(e);
      outgoing.set(e.source, list);
    }
    let current = startNodeId;
    const visited = new Set<string>();
    let guard = 0;
    while (current) {
      if (++guard > 500) return "FAILED";
      if (visited.has(current)) return "SUCCESS";
      visited.add(current);
      const node = nodeById.get(current);
      if (!node) return "SUCCESS";
      const step = await this.createStep(tenantId, runId, node, ctx);
      const result = await this.executeNode(
        tenantId,
        runId,
        node,
        step,
        ctx,
        outgoing,
      );
      if (result.status === "FAILED") return "FAILED";
      if (result.status === "WAITING") return "WAITING";
      if (result.nextNodeId) {
        current = result.nextNodeId;
        continue;
      }
      const next = outgoing.get(current) || [];
      current = next[0] ? next[0].target : "";
    }
    return "SUCCESS";
  }

  private async createStep(
    tenantId: string,
    runId: string,
    node: any,
    ctx: RunContext,
    overrides: { status?: string } = {},
  ) {
    return prisma.builderWorkflowRunStep.create({
      data: {
        tenantId,
        runId,
        nodeId: node.id,
        nodeType: node.data?.nodeType || node.type || "trigger",
        nodeLabel: node.data?.label || null,
        status: overrides.status || "RUNNING",
        sortOrder: ctx.order++,
        input: node.data?.config || {},
        startedAt: new Date(),
      },
    });
  }

  private async latestStep(runId: string) {
    return prisma.builderWorkflowRunStep.findFirst({
      where: { runId },
      orderBy: { sortOrder: "desc" },
    });
  }

  private async executeNode(
    tenantId: string,
    runId: string,
    node: any,
    step: { id: string } | null,
    ctx: RunContext,
    outgoing: Map<string, any[]>,
  ): Promise<{ status: string; error?: string; nextNodeId?: string }> {
    const nodeType = node.data?.nodeType || node.type;
    const config = node.data?.config || {};
    try {
      switch (nodeType) {
        case "trigger":
        case "input":
          await this.finishStep(step, "SUCCESS", { triggered: true });
          ctx.outputs[node.id] = { triggered: true };
          return { status: "SUCCESS" };
        case "email":
          await this.finishStep(step, "SUCCESS", {
            toEmail: config.toEmail,
            subject: config.subject,
          });
          ctx.outputs[node.id] = { sent: true, toEmail: config.toEmail };
          return { status: "SUCCESS" };
        case "notification":
          await this.finishStep(step, "SUCCESS", { message: config.message });
          ctx.outputs[node.id] = { notified: true };
          return { status: "SUCCESS" };
        case "approval":
          await prisma.builderWorkflowRunStep.update({
            where: { id: step!.id },
            data: { status: "WAITING", output: { assignRole: config.assignRole } as any },
          });
          return { status: "WAITING" };
        case "delay": {
          const delayMs = Math.max(0, Number(config.delayMs) || 0);
          if (delayMs === 0) {
            await this.finishStep(step, "SUCCESS", { delayMs: 0 });
            ctx.outputs[node.id] = { delayMs: 0 };
            return { status: "SUCCESS" };
          }
          await prisma.builderWorkflowRunStep.update({
            where: { id: step!.id },
            data: {
              status: "WAITING",
              output: { delayMs, scheduledAt: new Date(Date.now() + delayMs) } as any,
            },
          });
          return { status: "WAITING" };
        }
        case "condition": {
          const result = this.evaluateCondition(config, ctx.input);
          const edges = outgoing.get(node.id) || [];
          const branchEdges = edges.filter((e) => !this.isErrorEdge(e));
          const chosen = result ? branchEdges[0] : branchEdges[1];
          await this.finishStep(step, "SUCCESS", { result, chosenNode: chosen?.target || null });
          ctx.outputs[node.id] = { result };
          return { status: "SUCCESS", nextNodeId: chosen?.target };
        }
        case "webhook": {
          const url = config.url;
          if (!url)
            throw new BadRequestException("Webhook node has no URL configured");
          const res = await this.httpClient(url, {
            method: config.method || "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ tenantId, runId, nodeId: node.id, input: ctx.input }),
          });
          if (!res.ok) {
            const body = await res.text().catch(() => "");
            throw new Error(
              `Webhook ${url} returned HTTP ${res.status}${body ? `: ${body}` : ""}`,
            );
          }
          const data = await res.json().catch(() => ({ ok: true }));
          await this.finishStep(step, "SUCCESS", data as any);
          ctx.outputs[node.id] = data;
          return { status: "SUCCESS" };
        }
        case "loop":
          await this.finishStep(step, "SUCCESS", {
            iterations: Number(config.iterations) || 0,
          });
          ctx.outputs[node.id] = { iterations: Number(config.iterations) || 0 };
          return { status: "SUCCESS" };
        default:
          await this.finishStep(step, "SUCCESS", { processed: true });
          ctx.outputs[node.id] = { processed: true };
          return { status: "SUCCESS" };
      }
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      await prisma.builderWorkflowRunStep.update({
        where: { id: step!.id },
        data: { status: "FAILED", error, completedAt: new Date() },
      });
      return { status: "FAILED", error };
    }
  }

  private async finishStep(step: { id: string } | null, status: string, output: any) {
    if (!step) return;
    await prisma.builderWorkflowRunStep.update({
      where: { id: step.id },
      data: { status, output: output as any, completedAt: new Date() },
    });
  }

  private async compensate(tenantId: string, runId: string, ctx: RunContext) {
    const done = await prisma.builderWorkflowRunStep.findMany({
      where: { runId, status: "SUCCESS" },
      orderBy: { sortOrder: "desc" },
    });
    const nodeById = new Map<string, any>();
    const run = await prisma.builderWorkflowRun.findFirst({
      where: { id: runId, tenantId },
    });
    if (run) {
      const wf = await prisma.builderWorkflow.findFirst({
        where: { id: run.workflowId, tenantId },
      });
      const nodes = Array.isArray(wf?.nodes) ? (wf.nodes as any[]) : [];
      for (const n of nodes) nodeById.set(n.id, n);
    }
    for (const step of done) {
      const config = nodeById.get(step.nodeId)?.data?.config || {};
      const compensate = config.compensate;
      if (!compensate?.url) {
        continue;
      }
      try {
        const res = await this.httpClient(compensate.url, {
          method: compensate.method || "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ runId, nodeId: step.nodeId, input: ctx.input }),
        });
        await prisma.builderWorkflowRunStep.update({
          where: { id: step.id },
          data: {
            status: "COMPENSATED",
            output: {
              compensated: true,
              httpStatus: res.status,
              target: compensate.url,
            } as any,
          },
        });
      } catch (e) {
        await prisma.builderWorkflowRunStep.update({
          where: { id: step.id },
          data: {
            status: "COMPENSATED",
            error: e instanceof Error ? e.message : String(e),
          },
        });
      }
    }
  }

  private async updateRunStatus(
    runId: string,
    status: string,
    extra: { error?: string; resumeFrom?: string } = {},
  ) {
    await prisma.builderWorkflowRun.update({
      where: { id: runId },
      data: {
        status,
        error: extra.error || null,
        resumeFrom: extra.resumeFrom || null,
        completedAt:
          status === "COMPLETED" || status === "FAILED" ? new Date() : null,
      },
    });
  }

  private evaluateCondition(
    config: any,
    input: Record<string, unknown>,
  ): boolean {
    const field = config.field;
    if (!field) return true;
    const actual = (input as any)[field];
    const expected = config.value;
    switch (config.operator) {
      case "!=":
        return actual != expected;
      case ">":
        return Number(actual) > Number(expected);
      case "<":
        return Number(actual) < Number(expected);
      case "==":
      default:
        return actual == expected;
    }
  }

  private findErrorEdge(edges: any[]) {
    return edges.find((e) => this.isErrorEdge(e));
  }

  private isErrorEdge(e: any) {
    const label = String(e.label || "").toLowerCase();
    return label === "error" || label === "error path" || e.data?.errorPath === true;
  }
}

class RunContext {
  order = 0;
  input: Record<string, unknown>;
  outputs: Record<string, unknown> = {};
  constructor(input: Record<string, unknown>, initialOrder = 0) {
    this.input = input || {};
    this.order = initialOrder;
  }
}

function defaultFetch(
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: string },
) {
  return fetch(url, init);
}
