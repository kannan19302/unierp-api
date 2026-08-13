/**
 * M39 exit criterion: "A model is swapped for another provider's without
 * a code change and the evaluation suite runs against both. AI spend
 * appears in M27 allocation like any other cost. A guardrail failure
 * blocks the call and is audited."
 *
 * The proof mocks `@kannan19302/database` (as every plane-1 spec does)
 * and registers TWO real LogAiAdapter instances against `llm.complete`,
 * then asserts:
 *  1. the SAME `complete()` call routes to provider A, and — after only
 *     a DATA change (an unhealthy health check row, read by M06 on every
 *     call) — routes to provider B, no code change anywhere;
 *  2. `runEvalSuite` produces ONE AiEvalRun per bound provider, each with
 *     a full per-case result list;
 *  3. after a successful completion with a price sheet entry, the AI
 *     cost appears in `CostAllocationService.getTenantCostForPeriod` for
 *     the tenant whose resource the line item is attributed to;
 *  4. a BLOCK guardrail policy stops the call BEFORE any provider adapter
 *     executes, records an AiGuardrailEvent, and writes to the M14 audit
 *     spine.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ForbiddenException } from "@nestjs/common";

let providersRows: any[];
let bindings: any[];
let healthChecks: any[];
let circuitStates: any[];
let priceEntries: any[];
let overrides: any[];
let stickyAssignments: any[];
let guardrailPolicies: any[];
let guardrailEvents: any[];
let providerModels: any[];
let evalSuites: any[];
let evalCases: any[];
let evalRuns: any[];
let meteringEvents: any[];
let usageRecords: any[];
let costBatches: any[];
let costLineItems: any[];
let attributions: any[];
let auditLogs: any[];
let seq = 0;
const nextId = (p: string) => `${p}-${++seq}`;

vi.mock("@kannan19302/database", () => ({
  prisma: {
    $transaction: vi.fn((cb: any) => cb(prismaMock)),
    provider: {
      create: vi.fn(({ data }: any) => {
        const row = { id: nextId("prov"), status: "ACTIVE", description: null, ...data };
        providersRows.push(row);
        return row;
      }),
      findUnique: vi.fn(({ where: { id } }: any) => providersRows.find((p) => p.id === id) ?? null),
    },
    providerBinding: {
      upsert: vi.fn(({ create }: any) => {
        if (!bindings.some((b) => b.providerId === create.providerId && b.capabilityId === create.capabilityId)) {
          bindings.push({ providerId: create.providerId, capabilityId: create.capabilityId, priority: 100 });
        }
        return create;
      }),
      findMany: vi.fn(({ where, include }: any) =>
        bindings
          .filter((b) => b.capabilityId === where?.capabilityId)
          .sort((a, b) => a.priority - b.priority)
          .map((b) => (include?.provider ? { ...b, provider: providersRows.find((p) => p.id === b.providerId) } : b)),
      ),
    },
    providerCredential: { findMany: vi.fn(() => []) },
    providerCapability: { upsert: vi.fn(({ create }: any) => ({ id: nextId("cap"), ...create })) },
    providerHealthConfig: { findUnique: vi.fn(() => null) },
    providerHealthCheck: {
      findFirst: vi.fn(({ where }: any) =>
        healthChecks.filter((h) => h.providerId === where.providerId).sort((a, b) => b.idx - a.idx)[0] ?? null,
      ),
      create: vi.fn(({ data }: any) => {
        const row = { id: nextId("hc"), checkedAt: new Date(), idx: healthChecks.length, ...data };
        healthChecks.push(row);
        return row;
      }),
    },
    providerCircuitState: {
      findUnique: vi.fn(({ where: { providerId } }: any) => circuitStates.find((c) => c.providerId === providerId) ?? null),
      create: vi.fn(({ data }: any) => { const row = { id: nextId("circ"), ...data }; circuitStates.push(row); return row; }),
      update: vi.fn(({ where: { providerId }, data }: any) => {
        const row = circuitStates.find((c) => c.providerId === providerId)!;
        Object.assign(row, data);
        return row;
      }),
    },
    providerPriceSheetEntry: {
      findUnique: vi.fn(({ where }: any) => {
        const k = where.providerId_capabilityId_operation_unit;
        return (
          priceEntries.find(
            (e) =>
              e.providerId === k.providerId &&
              e.capabilityId === k.capabilityId &&
              e.operation === k.operation &&
              e.unit === k.unit,
          ) ?? null
        );
      }),
      upsert: vi.fn(({ create }: any) => {
        const row = { id: nextId("price"), observedAt: new Date(), ...create };
        priceEntries.push(row);
        return row;
      }),
    },
    tenantProviderOverride: { findUnique: vi.fn(() => null), upsert: vi.fn(({ create }: any) => create), deleteMany: vi.fn() },
    stickyRouteAssignment: { findUnique: vi.fn(() => null), upsert: vi.fn(({ create }: any) => { stickyAssignments.push(create); return create; }) },

    aiProviderModel: {
      create: vi.fn(({ data }: any) => { const row = { id: nextId("model"), status: "ACTIVE", ...data }; providerModels.push(row); return row; }),
      findMany: vi.fn(({ where }: any) => providerModels.filter((m) => m.providerId === where.providerId)),
      findFirst: vi.fn(({ where }: any) => providerModels.filter((m) => m.providerId === where.providerId)[0] ?? null),
    },
    aiGuardrailPolicy: {
      findMany: vi.fn(({ where }: any) => guardrailPolicies.filter((p) => (where?.enabled === undefined ? true : p.enabled === where.enabled))),
      create: vi.fn(({ data }: any) => { const row = { id: nextId("grp"), ...data }; guardrailPolicies.push(row); return row; }),
      findUnique: vi.fn(({ where: { id } }: any) => guardrailPolicies.find((p) => p.id === id) ?? null),
      update: vi.fn(({ where: { id }, data }: any) => { const row = guardrailPolicies.find((p) => p.id === id)!; Object.assign(row, data); return row; }),
    },
    aiGuardrailEvent: {
      create: vi.fn(({ data }: any) => { const row = { id: nextId("grev"), createdAt: new Date(), ...data }; guardrailEvents.push(row); return row; }),
      findMany: vi.fn(({ where }: any) => guardrailEvents.filter((e) => (where?.policyId ? e.policyId === where.policyId : true))),
    },
    aiEvalSuite: {
      create: vi.fn(({ data }: any) => { const row = { id: nextId("suite"), createdAt: new Date(), ...data }; evalSuites.push(row); return row; }),
      findUnique: vi.fn(({ where: { id }, include }: any) => {
        const s = evalSuites.find((x) => x.id === id) ?? null;
        if (s && include?.cases) s.cases = evalCases.filter((c) => c.suiteId === id);
        return s;
      }),
      findMany: vi.fn(({ include }: any) =>
        evalSuites.map((s) => ({ ...s, cases: include?.cases ? evalCases.filter((c) => c.suiteId === s.id) : [] })),
      ),
    },
    aiEvalCase: {
      create: vi.fn(({ data }: any) => { const row = { id: nextId("case"), ...data }; evalCases.push(row); return row; }),
    },
    aiEvalRun: {
      create: vi.fn(({ data }: any) => { const row = { id: nextId("run"), startedAt: new Date(), ...data }; evalRuns.push(row); return row; }),
      update: vi.fn(({ where: { id }, data }: any) => { const row = evalRuns.find((r) => r.id === id)!; Object.assign(row, data); return row; }),
      findMany: vi.fn(({ where }: any) => evalRuns.filter((r) => (where?.suiteId ? r.suiteId === where.suiteId : true))),
    },

    meteringEvent: {
      findUnique: vi.fn(({ where }: any) => meteringEvents.find((e) => e.idempotencyKey === where.idempotencyKey) ?? null),
      create: vi.fn(({ data }: any) => { const row = { id: nextId("evt"), timestamp: new Date(), ...data }; meteringEvents.push(row); return row; }),
    },
    usageRecord: {
      upsert: vi.fn(({ where, create, update }: any) => {
        const key = where.tenantId_metric;
        let row = usageRecords.find((u) => u.tenantId === key.tenantId && u.metric === key.metric);
        if (!row) { row = { id: nextId("usage"), ...create }; usageRecords.push(row); }
        else { row.currentValue += (update.currentValue?.increment ?? 0); }
        return row;
      }),
    },

    costIngestionBatch: {
      findUnique: vi.fn(({ where, include }: any) => {
        const k = where.providerId_period;
        const b = costBatches.find((x) => x.providerId === k.providerId && x.period === k.period) ?? null;
        if (b && include?.lineItems) b.lineItems = costLineItems.filter((l) => l.batchId === b.id);
        return b;
      }),
      findMany: vi.fn(({ where, include }: any) =>
        costBatches
          .filter((b) => (where?.period ? b.period === where.period : true))
          .map((b) => (include?.lineItems ? { ...b, lineItems: costLineItems.filter((l) => l.batchId === b.id) } : b)),
      ),
      create: vi.fn(({ data }: any) => { const row = { id: nextId("cb"), ...data }; costBatches.push(row); return row; }),
      update: vi.fn(({ where: { id }, data }: any) => { const row = costBatches.find((b) => b.id === id)!; Object.assign(row, data); return row; }),
    },
    costLineItem: {
      create: vi.fn(({ data }: any) => { const row = { id: nextId("cli"), ...data }; costLineItems.push(row); return row; }),
      findFirst: vi.fn(({ where }: any) => costLineItems.find((l) => l.batchId === where.batchId && l.sourceLineId === where.sourceLineId) ?? null),
    },
    resourceAttribution: {
      findMany: vi.fn(() => attributions.map((a) => ({ ...a }))),
    },
    controlPlaneAuditLog: {
      findFirst: vi.fn(() => null),
      create: vi.fn(({ data }: any) => { const row = { id: nextId("audit"), sequenceNum: auditLogs.length + 1, ...data }; auditLogs.push(row); return row; }),
      findMany: vi.fn(({ where }: any) => auditLogs.filter((r) => (where?.actorId ? r.actorId === where.actorId : true))),
    },
  },
}));

vi.mock("@kannan19302/shared", () => ({ bindProvider: vi.fn(), unbindProvider: vi.fn() }));

import { prisma as prismaMock } from "@kannan19302/database";
import { ProviderRegistryService } from "../provider-registry/provider-registry.service";
import { RoutingService } from "../provider-registry/routing.service";
import { ControlPlaneAuditService } from "./control-plane-audit.service";
import { MeteringService } from "./metering.service";
import { CostIngestionService, multiplyDecimalByInteger } from "./cost-ingestion.service";
import { CostAllocationService } from "./cost-allocation.service";
import { toCents, centsToDecimalString } from "./cost-allocation";
import { AiGatewayService } from "./ai-gateway.service";
import { LogAiAdapter } from "../provider-registry/adapters/log-ai.adapter";

describe("M39 · AI gateway, guardrails, eval and AI spend in M27", () => {
  let providersSvc: ProviderRegistryService;
  let routing: RoutingService;
  let audit: ControlPlaneAuditService;
  let metering: MeteringService;
  let costs: CostIngestionService;
  let allocation: CostAllocationService;
  let gateway: AiGatewayService;

  beforeEach(() => {
    vi.clearAllMocks();
    providersRows = [];
    bindings = [];
    healthChecks = [];
    circuitStates = [];
    priceEntries = [];
    overrides = [];
    stickyAssignments = [];
    guardrailPolicies = [];
    guardrailEvents = [];
    providerModels = [];
    evalSuites = [];
    evalCases = [];
    evalRuns = [];
    meteringEvents = [];
    usageRecords = [];
    costBatches = [];
    costLineItems = [];
    attributions = [];
    auditLogs = [];
    providersSvc = new ProviderRegistryService();
    routing = new RoutingService(providersSvc);
    audit = new ControlPlaneAuditService();
    metering = new MeteringService(audit);
    costs = new CostIngestionService();
    allocation = new CostAllocationService();
    gateway = new AiGatewayService(providersSvc, routing, audit, metering, costs);
  });

  async function registerAiProvider(name: string) {
    const provider = await gateway.registerAiProvider(name, new LogAiAdapter("will-be-set"));
    const adapter = new LogAiAdapter(provider.id);
    providersSvc.registerAdapter(provider.id, adapter);
    await providersSvc.recordHealthCheck(provider.id, { healthy: true });
    return { provider, adapter };
  }

  it("the SAME complete() routes to provider A then — after only a DATA change (an unhealthy health row) — to provider B, no code change", async () => {
    const a = await registerAiProvider("ai-primary");
    const b = await registerAiProvider("ai-secondary");
    bindings.find((x) => x.providerId === b.provider.id)!.priority = 200;

    const r1 = await gateway.complete({ tenantId: "t-1", prompt: "hello primary", resourceId: "res-1", actorId: "op-1" });
    expect(r1.providerId).toBe(a.provider.id);
    expect(a.adapter.completed).toHaveLength(1);

    // Disabling the primary is a DATA change: an unhealthy health check row.
    await providersSvc.recordHealthCheck(a.provider.id, { healthy: false, error: "down for maintenance" });

    const r2 = await gateway.complete({ tenantId: "t-1", prompt: "hello secondary", resourceId: "res-1", actorId: "op-1" });
    expect(r2.providerId).toBe(b.provider.id);
    expect(b.adapter.completed).toHaveLength(1);
    expect(a.adapter.completed).toHaveLength(1); // primary received no further calls
  });

  it("the eval suite runs against BOTH bound providers — one AiEvalRun each, full per-case results", async () => {
    const a = await registerAiProvider("ai-primary");
    const b = await registerAiProvider("ai-secondary");
    bindings.find((x) => x.providerId === b.provider.id)!.priority = 200;

    const suite = await gateway.createEvalSuite({
      name: "greeting",
      cases: [
        { name: "says hello", prompt: "hello there", expected: "hello there" },
        { name: "says goodbye", prompt: "goodbye now", expected: "goodbye now" },
      ],
    });
    const runs = await gateway.runEvalSuite(suite.id);

    expect(runs).toHaveLength(2);
    const providerIds = (runs as any[]).map((r) => r.providerId).sort();
    expect(providerIds).toEqual([a.provider.id, b.provider.id].sort());

    for (const run of runs as any[]) {
      expect(run.passedCount).toBe(2);
      expect(run.failedCount).toBe(0);
      expect(run.status).toBe("PASSED");
      expect(run.results).toHaveLength(2);
    }
  });

  it("AI spend appears in M27 allocation like any other cost", async () => {
    const { provider } = await registerAiProvider("ai-priced");
    await providersSvc.recordPriceSheetEntry(provider.id, {
      capabilityId: "llm.complete",
      operation: "complete",
      unit: "token",
      pricePerUnit: "0.0100",
      currency: "USD",
    });
    attributions.push({
      resourceId: "ai-res-tenant-9",
      tenantId: "tenant-9",
      service: "ai",
      environment: "prod",
      owner: "ops",
      attributedBy: "test",
    });

    const period = new Date().toISOString().slice(0, 7);
    const prompt = "hello";
    const expectedCost = multiplyDecimalByInteger("0.0100", prompt.length); // "0.0500"
    // M27 allocation rounds to the cent exactly like any other cost line.
    const expectedAllocated = centsToDecimalString(toCents(expectedCost));

    const result = await gateway.complete({
      tenantId: "tenant-9",
      prompt,
      resourceId: "ai-res-tenant-9",
      actorId: "op-1",
      correlationId: "corr-9",
    });
    expect(result.cost).toBe(expectedCost);

    const tenantCost = await allocation.getTenantCostForPeriod("tenant-9", period);
    expect(tenantCost.totalCost).toBe(expectedAllocated);
    expect(tenantCost.sourceLineItemIds).toHaveLength(1);
  });

  it("a guardrail BLOCK stops the call before any provider executes and is audited", async () => {
    const { provider, adapter } = await registerAiProvider("ai-guarded");
    await governanceCreateBlockPolicy("No proprietary data", ["proprietary"]);

    await expect(
      gateway.complete({
        tenantId: "t-1",
        prompt: "summarise the proprietary dataset",
        resourceId: "res-1",
        actorId: "op-1",
        correlationId: "corr-block",
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(adapter.completed).toHaveLength(0); // provider never contacted
    expect(guardrailEvents).toHaveLength(1);
    expect(guardrailEvents[0]!.action).toBe("BLOCK");
    expect(guardrailEvents[0]!.tenantRef).toBe("t-1");
    expect(guardrailEvents[0]!.inputHash).toMatch(/^[a-f0-9]{64}$/);
    expect(auditLogs).toHaveLength(1);
    expect(auditLogs[0]!.action).toBe("ai.guardrail.block");
    expect(auditLogs[0]!.targetId).toBe("t-1");
    expect(auditLogs[0]!.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(await audit.verifyChain("op-1")).toEqual({ verified: 1 });
  });

  it("a WARN guardrail records the event but still completes", async () => {
    const { provider, adapter } = await registerAiProvider("ai-warn");
    await (prismaMock as any).aiGuardrailPolicy.create({
      data: {
        name: "Watch sensitive",
        ruleType: "KEYWORD",
        rule: { patterns: ["sensitive"] },
        action: "WARN",
        severity: "low",
        enabled: true,
      },
    });

    const result = await gateway.complete({
      tenantId: "t-1",
      prompt: "handle sensitive data carefully",
      resourceId: "res-1",
      actorId: "op-1",
    });
    expect(result.providerId).toBe(provider.id);
    expect(adapter.completed).toHaveLength(1);
    expect(guardrailEvents).toHaveLength(1);
    expect(guardrailEvents[0]!.action).toBe("WARN");
    expect(auditLogs).toHaveLength(0); // WARN is not a block; only blocks are audited
  });
});

async function governanceCreateBlockPolicy(name: string, patterns: string[]) {
  await (prismaMock as any).aiGuardrailPolicy.create({
    data: { name, ruleType: "KEYWORD", rule: { patterns }, action: "BLOCK", severity: "high", enabled: true },
  });
}