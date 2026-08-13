/**
 * M39 — HTTP surface for AI governance. `read` can view provider models,
 * guardrail policies and eval suites; `manage` can register providers/
 * models/agents/MCP/RAG, version prompts, and invoke the AI gateway. A
 * completion that trips a BLOCK guardrail returns 403 — the same
 * ForbiddenException the gateway throws — and is recorded on the audit
 * spine.
 */
import { Controller, Get, Post, Body, Param, Query, UseGuards } from "@nestjs/common";
import { ApiTags, ApiOperation, ApiBearerAuth } from "@nestjs/swagger";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RbacGuard } from "../../common/guards/rbac.guard";
import { ControlPlaneGuard } from "../../common/guards/control-plane.guard";
import { StepUpMfaGuard } from "../../common/guards/step-up-mfa.guard";
import { SkipTenantScope } from "../../common/decorators/skip-tenant-scope.decorator";
import { Permissions } from "../../common/decorators/permissions.decorator";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { AiGatewayService } from "./ai-gateway.service";
import { AiGovernanceService } from "./ai-governance.service";

@ApiTags("platform")
@ApiBearerAuth()
@Controller("platform/v1/ai")
@UseGuards(JwtAuthGuard, RbacGuard, ControlPlaneGuard, StepUpMfaGuard)
@SkipTenantScope()
export class AiGovernanceController {
  constructor(
    private readonly gateway: AiGatewayService,
    private readonly governance: AiGovernanceService,
  ) {}

  // ── gateway ──

  @ApiOperation({ summary: "Invoke the AI gateway — routes `llm.complete`, meters tokens and AI spend, applies guardrails (403 on a BLOCK)" })
  @Post("completions")
  @Permissions("system.ai.manage")
  async complete(
    @Body()
    body: {
      tenantId: string;
      prompt: string;
      model?: string;
      maxTokens?: number;
      resourceId: string;
      correlationId?: string;
    },
    @CurrentUser() user: any,
  ) {
    return this.gateway.complete({
      tenantId: body.tenantId,
      prompt: body.prompt,
      model: body.model,
      maxTokens: body.maxTokens,
      resourceId: body.resourceId,
      actorId: user?.userId ?? "unknown",
      correlationId: body.correlationId,
    });
  }

  @ApiOperation({ summary: "Register an AI provider bound to llm.complete (adapter is code, registered at startup)" })
  @Post("providers")
  @Permissions("system.ai.manage")
  async registerProvider(@Body() body: { name: string; description?: string }) {
    const provider = await this.gateway.providers.registerProvider({
      name: body.name,
      description: body.description ?? undefined,
    });
    await this.gateway.providers.bindCapability(provider.id, "llm.complete");
    return provider;
  }

  @ApiOperation({ summary: "Register a model a provider offers for llm.complete" })
  @Post("providers/:providerId/models")
  @Permissions("system.ai.manage")
  async registerModel(@Param("providerId") providerId: string, @Body() body: { modelId: string; version?: string; capabilities?: string[]; config?: Record<string, unknown> }) {
    return this.gateway.registerProviderModel(providerId, body);
  }

  @ApiOperation({ summary: "List a provider's registered models" })
  @Get("providers/:providerId/models")
  @Permissions("system.ai.read")
  async listModels(@Param("providerId") providerId: string) {
    return this.gateway.listProviderModels(providerId);
  }

  @ApiOperation({ summary: "Providers bound to llm.complete" })
  @Get("providers")
  @Permissions("system.ai.read")
  async listProviders() {
    return this.gateway.providers.getProvidersForCapability("llm.complete");
  }

  // ── guardrails ──

  @ApiOperation({ summary: "Create a guardrail policy (BLOCK/WARN) evaluated before every completion" })
  @Post("guardrails")
  @Permissions("system.ai.manage")
  async createGuardrail(@Body() body: { name: string; ruleType: "KEYWORD" | "REGEX" | "PII" | "TOXICITY"; rule?: Record<string, unknown>; action?: "BLOCK" | "WARN"; severity?: "high" | "medium" | "low"; enabled?: boolean }) {
    return this.governance.createGuardrailPolicy(body);
  }

  @ApiOperation({ summary: "List guardrail policies" })
  @Get("guardrails")
  @Permissions("system.ai.read")
  async listGuardrails() {
    return this.governance.listGuardrailPolicies();
  }

  @ApiOperation({ summary: "Enable/disable a guardrail policy or switch BLOCK/WARN" })
  @Post("guardrails/:id")
  @Permissions("system.ai.manage")
  async updateGuardrail(@Param("id") id: string, @Body() body: { enabled?: boolean; action?: "BLOCK" | "WARN" }) {
    return this.governance.updateGuardrailPolicy(id, body);
  }

  @ApiOperation({ summary: "Guardrail events — every BLOCK and WARN trigger, traceable per policy/tenant" })
  @Get("guardrails/events")
  @Permissions("system.ai.read")
  async guardrailEvents(@Query("policyId") policyId?: string) {
    return this.gateway.listGuardrailEvents(policyId);
  }

  // ── eval ──

  @ApiOperation({ summary: "Create an eval suite with cases" })
  @Post("eval-suites")
  @Permissions("system.ai.manage")
  async createEvalSuite(@Body() body: { name: string; description?: string; cases: Array<{ name: string; prompt: string; expected: string }> }) {
    return this.gateway.createEvalSuite(body);
  }

  @ApiOperation({ summary: "List eval suites with their cases" })
  @Get("eval-suites")
  @Permissions("system.ai.read")
  async listEvalSuites() {
    return this.gateway.listEvalSuites();
  }

  @ApiOperation({ summary: "Run an eval suite against every provider bound to llm.complete" })
  @Post("eval-suites/:id/run")
  @Permissions("system.ai.manage")
  async runEvalSuite(@Param("id") id: string) {
    return this.gateway.runEvalSuite(id);
  }

  @ApiOperation({ summary: "List eval runs (one per provider per suite run)" })
  @Get("eval-runs")
  @Permissions("system.ai.read")
  async listEvalRuns(@Query("suiteId") suiteId?: string) {
    return this.gateway.listEvalRuns(suiteId);
  }

  // ── registrations ──

  @ApiOperation({ summary: "Register an approved agent" })
  @Post("agents")
  @Permissions("system.ai.manage")
  async registerAgent(@Body() body: { agentKey: string; name: string; description?: string; modelId?: string; providerId?: string; mcpServerIds?: string[]; ragIndexIds?: string[] }) {
    return this.governance.registerAgent(body);
  }

  @ApiOperation({ summary: "List approved agent registrations" })
  @Get("agents")
  @Permissions("system.ai.read")
  async listAgents() {
    return this.governance.listAgents();
  }

  @ApiOperation({ summary: "Register an MCP server" })
  @Post("mcp-servers")
  @Permissions("system.ai.manage")
  async registerMcpServer(@Body() body: { name: string; endpoint: string; authSecretRef?: string; capabilities?: string[] }) {
    return this.governance.registerMcpServer(body);
  }

  @ApiOperation({ summary: "List MCP server registrations" })
  @Get("mcp-servers")
  @Permissions("system.ai.read")
  async listMcpServers() {
    return this.governance.listMcpServers();
  }

  @ApiOperation({ summary: "Register a RAG index" })
  @Post("rag-indexes")
  @Permissions("system.ai.manage")
  async registerRagIndex(@Body() body: { name: string; source?: string; embeddingModel: string; chunkCount?: number }) {
    return this.governance.registerRagIndex(body);
  }

  @ApiOperation({ summary: "List RAG index registrations" })
  @Get("rag-indexes")
  @Permissions("system.ai.read")
  async listRagIndexes() {
    return this.governance.listRagIndexes();
  }

  @ApiOperation({ summary: "Create a new prompt version (append-only, does not auto-activate)" })
  @Post("prompts")
  @Permissions("system.ai.manage")
  async createPromptVersion(@Body() body: { name: string; slug: string; content: string; variables?: string[] }) {
    return this.governance.createPromptVersion(body);
  }

  @ApiOperation({ summary: "List prompt versions (all slugs, or one slug's history)" })
  @Get("prompts")
  @Permissions("system.ai.read")
  async listPromptVersions(@Query("slug") slug?: string) {
    return this.governance.listPromptVersions(slug);
  }

  @ApiOperation({ summary: "Activate a prompt version (deactivates the rest of its slug)" })
  @Post("prompts/:id/activate")
  @Permissions("system.ai.manage")
  async activatePromptVersion(@Param("id") id: string) {
    return this.governance.activatePromptVersion(id);
  }
}