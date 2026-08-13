/**
 * M39 — the AI gateway. The ONE surface any caller uses to request an
 * `llm.complete` completion — the `DnsService` of AI. Which provider
 * serves a call is M06's routing decision (priority, health, circuit
 * breaker, tenant pin — all data, never a branch on a provider id), so a
 * model is swapped for another provider's WITHOUT a code change.
 *
 * Exit criterion, in one pass through `complete()`:
 *  1. A guardrail failure BLOCKS the call — evaluated BEFORE any provider
 *     is contacted, recorded as an AiGuardrailEvent AND on the M14 audit
 *     spine. The provider adapter never runs.
 *  2. On success, token usage is metered (C14 metering event, metric
 *     "ai.tokens") and the call's cost — tokens × price sheet, all in
 *     decimal-string arithmetic — is APPENDED to the provider's M27
 *     CostIngestionBatch with a resourceId attributed to the tenant, so
 *     AI spend appears in M27 allocation exactly like any other cost.
 *
 * The evaluation suite (`runEvalSuite`) runs the same cases against BOTH
 * providers bound to `llm.complete` and records one AiEvalRun per
 * provider — the "evaluation suite runs against both" half of the exit
 * criterion.
 */
import { Injectable, ForbiddenException, BadRequestException, NotFoundException } from "@nestjs/common";
import { createHash } from "crypto";
import { prisma } from "@kannan19302/database";
import { ProviderRegistryService } from "../provider-registry/provider-registry.service";
import { RoutingService } from "../provider-registry/routing.service";
import { ControlPlaneAuditService } from "./control-plane-audit.service";
import { MeteringService } from "./metering.service";
import { CostIngestionService, multiplyDecimalByInteger } from "./cost-ingestion.service";
import type { CapabilityAdapter, ExecutionResult } from "../provider-registry/adapter-contract";

const LLM_CAPABILITY = "llm.complete";
const PRICE_OPERATION = "complete";
const PRICE_UNIT = "token";

export interface AiCompletionInput {
  tenantId: string;
  prompt: string;
  model?: string;
  maxTokens?: number;
  /** The tenant-attributed resource the AI cost attaches to, so M27
   *  allocation attributes it like any other cost line item. */
  resourceId: string;
  actorId: string;
  correlationId?: string;
}

export interface AiCompletionResult {
  providerId: string;
  reason: string;
  completion: string;
  tokensUsed: number;
  cost: string;
}

@Injectable()
export class AiGatewayService {
  constructor(
    readonly providers: ProviderRegistryService,
    private readonly routing: RoutingService,
    private readonly audit: ControlPlaneAuditService,
    private readonly metering: MeteringService,
    private readonly costs: CostIngestionService,
  ) {}

  /** Register an AI provider: bound to `llm.complete` and given the code
   *  that actually talks to it (M05's CapabilityAdapter). Mirrors
   *  DnsService.registerDnsProvider exactly. */
  async registerAiProvider(providerName: string, adapter: CapabilityAdapter) {
    const provider = await this.providers.registerProvider({ name: providerName });
    await this.providers.bindCapability(provider.id, LLM_CAPABILITY);
    this.providers.registerAdapter(provider.id, adapter);
    return provider;
  }

  /** Record a model a provider offers for `llm.complete`. */
  async registerProviderModel(providerId: string, model: { modelId: string; version?: string; capabilities?: string[]; config?: Record<string, unknown> }) {
    if (!model.modelId) throw new BadRequestException("modelId is required");
    return (prisma as any).aiProviderModel.create({
      data: {
        providerId,
        modelId: model.modelId,
        version: model.version ?? null,
        capabilities: model.capabilities ?? [],
        config: model.config ?? null,
      },
    });
  }

  async listProviderModels(providerId: string) {
    return (prisma as any).aiProviderModel.findMany({ where: { providerId }, orderBy: { createdAt: "desc" } });
  }

  /**
   * One completion call. Order of operations is load-bearing:
   * guardrails FIRST (a blocked call never touches a provider), routing
   * second, execution third, metering + cost last (a failed call records
   * its routing outcome but no spend).
   */
  async complete(input: AiCompletionInput): Promise<AiCompletionResult> {
    const matches = await this.evaluateGuardrails(input.prompt);
    const block = matches.find((m) => m.action === "BLOCK");
    if (block) {
      await this.recordGuardrailEvent(input, block);
      throw new ForbiddenException(
        `AI call blocked by guardrail "${block.name}" (${block.ruleType})`,
      );
    }
    // WARN rules shadow without blocking: record the event, continue.
    for (const warn of matches.filter((m) => m.action === "WARN")) {
      await this.recordGuardrailEvent(input, warn);
    }

    const decision = await this.routing.resolve({
      tenantId: input.tenantId,
      capabilityId: LLM_CAPABILITY,
      stickyKey: input.model,
    });
    const adapter = this.providers.getAdapter(decision.providerId) as CapabilityAdapter | undefined;
    if (!adapter) {
      throw new Error(`Provider ${decision.providerId} was routed to but has no registered adapter`);
    }

    const result: ExecutionResult = await adapter.execute({
      prompt: input.prompt,
      model: input.model ?? null,
      maxTokens: input.maxTokens ?? null,
    });
    await this.routing.recordCall(decision.providerId, LLM_CAPABILITY, { success: result.success });
    if (!result.success) {
      throw new BadRequestException(`AI completion failed via provider ${decision.providerId}: ${result.error}`);
    }

    const tokensUsed = Number(result.output?.tokensUsed ?? 0);
    const completion = String(result.output?.completion ?? "");
    const cost = await this.recordAiSpend(input, decision.providerId, tokensUsed, completion);

    return { providerId: decision.providerId, reason: decision.reason, completion, tokensUsed, cost };
  }

  /**
   * Meter the call's tokens (C14) and append its cost to the provider's
   * M27 batch. Cost = tokens × price-per-token from the SAME price sheet
   * M06 routes on and M25 costs against (`getPriceFor` — the single read
   * path, never a second copy).
   */
  private async recordAiSpend(
    input: AiCompletionInput,
    providerId: string,
    tokensUsed: number,
    completion: string,
  ): Promise<string> {
    if (tokensUsed > 0) {
      await this.metering.recordEvent(
        input.tenantId,
        {
          metric: "ai.tokens",
          quantity: tokensUsed,
          idempotencyKey: `ai:tokens:${input.correlationId ?? "no-corr"}:${providerId}`,
          source: `ai-gateway:${providerId}`,
        },
        input.actorId,
      );
    }

    const price = await this.providers.getPriceFor(providerId, LLM_CAPABILITY, PRICE_OPERATION, PRICE_UNIT);
    if (!price) {
      // No price sheet entry → nothing can be charged. Honest zero, not a
      // silently absent cost line: the exit criterion's "AI spend appears
      // like any other cost" only holds where a price exists to compute it.
      return "0.0000";
    }
    const cost = multiplyDecimalByInteger(price.pricePerUnit.toString(), tokensUsed);
    const period = new Date().toISOString().slice(0, 7);
    const sourceLineId = `ai:${input.correlationId ?? "no-corr"}:${providerId}:${new Date().getTime()}`;

    await this.costs.recordMeteredCost({
      providerId,
      period,
      currency: price.currency ?? "USD",
      lineItem: {
        sourceLineId,
        description: `LLM completion via ${input.model ?? "default"} (${completion.length} chars)`,
        amount: cost,
        resourceId: input.resourceId,
      },
    });
    return cost;
  }

  // ── guardrails ──

  /**
   * Every enabled policy is evaluated; all matches are returned so the
   * caller can distinguish a BLOCK (stops the call) from a WARN (shadow
   * mode: recorded, allowed through). Both record an AiGuardrailEvent;
   * only BLOCK also writes to the audit spine.
   */
  async evaluateGuardrails(prompt: string): Promise<Array<{ id: string; name: string; ruleType: string; action: string }>> {
    const policies = await (prisma as any).aiGuardrailPolicy.findMany({ where: { enabled: true } });
    return policies
      .filter((policy: any) => this.matchesPolicy(policy, prompt))
      .map((policy: any) => ({ id: policy.id, name: policy.name, ruleType: policy.ruleType, action: policy.action }));
  }

  private matchesPolicy(policy: any, prompt: string): boolean {
    const rule = policy.rule ?? {};
    switch (policy.ruleType) {
      case "KEYWORD": {
        const patterns: string[] = Array.isArray(rule.patterns) ? rule.patterns : [];
        const lowered = prompt.toLowerCase();
        return patterns.some((p) => lowered.includes(String(p).toLowerCase()));
      }
      case "REGEX": {
        const patterns: string[] = Array.isArray(rule.patterns) ? rule.patterns : [];
        return patterns.some((p) => new RegExp(String(p)).test(prompt));
      }
      default:
        return false;
    }
  }

  private async recordGuardrailEvent(
    input: AiCompletionInput,
    policy: { id: string; name: string; ruleType: string; action: string },
  ): Promise<void> {
    const inputHash = createHash("sha256").update(input.prompt).digest("hex");
    await (prisma as any).aiGuardrailEvent.create({
      data: {
        policyId: policy.id,
        action: policy.action,
        tenantRef: input.tenantId,
        inputHash,
        detail: { policyName: policy.name, ruleType: policy.ruleType, actorId: input.actorId },
      },
    });
    if (policy.action === "BLOCK") {
      await this.audit.record({
        actorId: input.actorId,
        actorRole: "SUPER_ADMIN",
        action: "ai.guardrail.block",
        targetId: input.tenantId,
        details: { policyId: policy.id, policyName: policy.name, ruleType: policy.ruleType, inputHash },
        correlationId: input.correlationId ?? null,
      });
    }
  }

  async listGuardrailEvents(policyId?: string) {
    return (prisma as any).aiGuardrailEvent.findMany({
      where: policyId ? { policyId } : {},
      orderBy: { createdAt: "desc" },
      take: 200,
    });
  }

  // ── eval suites ──

  /** Create a suite with its cases in one call. */
  async createEvalSuite(input: { name: string; description?: string; cases: Array<{ name: string; prompt: string; expected: string }> }) {
    if (!input.name) throw new BadRequestException("Suite name is required");
    if (!Array.isArray(input.cases) || input.cases.length === 0) {
      throw new BadRequestException("A suite must contain at least one case");
    }
    const suite = await (prisma as any).aiEvalSuite.create({
      data: { name: input.name, description: input.description ?? null },
    });
    for (const c of input.cases) {
      await (prisma as any).aiEvalCase.create({
        data: { suiteId: suite.id, name: c.name, prompt: c.prompt, expected: c.expected },
      });
    }
    return this.getEvalSuite(suite.id);
  }

  async getEvalSuite(suiteId: string) {
    const suite = await (prisma as any).aiEvalSuite.findUnique({
      where: { id: suiteId },
      include: { cases: true },
    });
    if (!suite) throw new NotFoundException(`Eval suite ${suiteId} not found`);
    return suite;
  }

  async listEvalSuites() {
    return (prisma as any).aiEvalSuite.findMany({ include: { cases: true }, orderBy: { createdAt: "desc" } });
  }

  /**
   * Run a suite against EVERY provider bound to `llm.complete` — one
   * AiEvalRun per provider — and return the runs. A run's pass/fail counts
   * must equal the suite's case count; a "passing" run with cases
   * unrecorded cannot happen because the counts are derived from the same
   * loop that evaluates each case.
   */
  async runEvalSuite(suiteId: string) {
    const suite = await this.getEvalSuite(suiteId);
    const boundProviders = await this.providers.getProvidersForCapability(LLM_CAPABILITY);

    const runs: unknown[] = [];
    for (const provider of boundProviders) {
      const adapter = this.providers.getAdapter(provider.id) as CapabilityAdapter | undefined;
      if (!adapter) continue;
      const model = await (prisma as any).aiProviderModel.findFirst({
        where: { providerId: provider.id },
        orderBy: { createdAt: "asc" },
      });

      const run = await (prisma as any).aiEvalRun.create({
        data: {
          suiteId: suite.id,
          providerId: provider.id,
          modelId: model?.modelId ?? "default",
          status: "RUNNING",
        },
      });

      const results: Array<{ caseId: string; caseName: string; passed: boolean; output: string }> = [];
      let passedCount = 0;
      let failedCount = 0;
      for (const c of suite.cases as any[]) {
        const result = await adapter.execute({ prompt: c.prompt });
        const output = result.success ? String(result.output?.completion ?? "") : "";
        const passed = result.success && output.includes(c.expected);
        if (passed) passedCount += 1;
        else failedCount += 1;
        results.push({ caseId: c.id, caseName: c.name, passed, output });
      }

      const finished = await (prisma as any).aiEvalRun.update({
        where: { id: run.id },
        data: {
          status: failedCount === 0 ? "PASSED" : "FAILED",
          passedCount,
          failedCount,
          results,
          completedAt: new Date(),
        },
      });
      runs.push(finished);
    }
    return runs;
  }

  async listEvalRuns(suiteId?: string) {
    return (prisma as any).aiEvalRun.findMany({
      where: suiteId ? { suiteId } : {},
      orderBy: { startedAt: "desc" },
      take: 200,
    });
  }
}