/**
 * M39 — AI governance registration surfaces and prompt versioning.
 *
 * The deliverable's registry half: agents, MCP servers and RAG indexes
 * are registered here (platform-owned, Track M precedent — no tenantId,
 * no RLS, schema-only additions like every Track M model), prompt
 * templates are versioned append-only, and guardrail policies are the
 * CRUD the gateway's `evaluateGuardrails` reads. Nothing here calls a
 * model; execution is the AiGatewayService's job, so a registration is a
 * declaration that is USED by the gateway rather than a parallel path.
 */
import { Injectable, BadRequestException, NotFoundException } from "@nestjs/common";
import { prisma } from "@kannan19302/database";

@Injectable()
export class AiGovernanceService {
  // ── agents ──

  async registerAgent(input: { agentKey: string; name: string; description?: string; modelId?: string; providerId?: string; mcpServerIds?: string[]; ragIndexIds?: string[] }) {
    if (!input.agentKey || !input.name) throw new BadRequestException("agentKey and name are required");
    return (prisma as any).aiAgentRegistration.create({
      data: {
        agentKey: input.agentKey,
        name: input.name,
        description: input.description ?? null,
        modelId: input.modelId ?? null,
        providerId: input.providerId ?? null,
        mcpServerIds: input.mcpServerIds ?? [],
        ragIndexIds: input.ragIndexIds ?? [],
      },
    });
  }

  async listAgents() {
    return (prisma as any).aiAgentRegistration.findMany({ orderBy: { createdAt: "desc" } });
  }

  // ── MCP servers ──

  async registerMcpServer(input: { name: string; endpoint: string; authSecretRef?: string; capabilities?: string[] }) {
    if (!input.name || !input.endpoint) throw new BadRequestException("name and endpoint are required");
    return (prisma as any).aiMcpServer.create({
      data: {
        name: input.name,
        endpoint: input.endpoint,
        authSecretRef: input.authSecretRef ?? null,
        capabilities: input.capabilities ?? [],
      },
    });
  }

  async listMcpServers() {
    return (prisma as any).aiMcpServer.findMany({ orderBy: { createdAt: "desc" } });
  }

  // ── RAG indexes ──

  async registerRagIndex(input: { name: string; source?: string; embeddingModel: string; chunkCount?: number }) {
    if (!input.name || !input.embeddingModel) throw new BadRequestException("name and embeddingModel are required");
    return (prisma as any).aiRagIndex.create({
      data: {
        name: input.name,
        source: input.source ?? null,
        embeddingModel: input.embeddingModel,
        chunkCount: input.chunkCount ?? 0,
      },
    });
  }

  async listRagIndexes() {
    return (prisma as any).aiRagIndex.findMany({ orderBy: { createdAt: "desc" } });
  }

  // ── prompt versioning ──

  /**
   * Append a new version for a slug. version is the max existing version
   * for that slug plus one — monotonic, never edited in place. The new
   * version does NOT auto-activate: activation is an explicit operator
   * step, so a draft can be created without silently changing what the
   * gateway renders.
   */
  async createPromptVersion(input: { name: string; slug: string; content: string; variables?: string[] }) {
    if (!input.name || !input.slug || !input.content) {
      throw new BadRequestException("name, slug and content are required");
    }
    const latest = await (prisma as any).aiPromptVersion.findFirst({
      where: { slug: input.slug },
      orderBy: { version: "desc" },
    });
    const version = (latest?.version ?? 0) + 1;
    return (prisma as any).aiPromptVersion.create({
      data: {
        name: input.name,
        slug: input.slug,
        version,
        content: input.content,
        variables: input.variables ?? [],
      },
    });
  }

  /** Explicit activation: deactivate every other version of the slug. */
  async activatePromptVersion(versionId: string) {
    const target = await (prisma as any).aiPromptVersion.findUnique({ where: { id: versionId } });
    if (!target) throw new NotFoundException(`Prompt version ${versionId} not found`);
    await (prisma as any).aiPromptVersion.updateMany({
      where: { slug: target.slug, isActive: true },
      data: { isActive: false },
    });
    return (prisma as any).aiPromptVersion.update({
      where: { id: versionId },
      data: { isActive: true },
    });
  }

  async listPromptVersions(slug?: string) {
    return (prisma as any).aiPromptVersion.findMany({
      where: slug ? { slug } : {},
      orderBy: [{ slug: "asc" }, { version: "desc" }],
    });
  }

  // ── guardrail policy CRUD ──

  async createGuardrailPolicy(input: {
    name: string;
    ruleType: "KEYWORD" | "REGEX" | "PII" | "TOXICITY";
    rule?: Record<string, unknown>;
    action?: "BLOCK" | "WARN";
    severity?: "high" | "medium" | "low";
    enabled?: boolean;
  }) {
    if (!input.name) throw new BadRequestException("name is required");
    if (!["KEYWORD", "REGEX", "PII", "TOXICITY"].includes(input.ruleType)) {
      throw new BadRequestException(`Unsupported ruleType ${input.ruleType}`);
    }
    return (prisma as any).aiGuardrailPolicy.create({
      data: {
        name: input.name,
        ruleType: input.ruleType,
        rule: input.rule ?? {},
        action: input.action ?? "BLOCK",
        severity: input.severity ?? "high",
        enabled: input.enabled ?? true,
      },
    });
  }

  async listGuardrailPolicies() {
    return (prisma as any).aiGuardrailPolicy.findMany({ orderBy: { createdAt: "desc" } });
  }

  async updateGuardrailPolicy(id: string, input: { enabled?: boolean; action?: "BLOCK" | "WARN" }) {
    const existing = await (prisma as any).aiGuardrailPolicy.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException(`Guardrail policy ${id} not found`);
    return (prisma as any).aiGuardrailPolicy.update({
      where: { id },
      data: {
        enabled: input.enabled ?? existing.enabled,
        action: input.action ?? existing.action,
      },
    });
  }
}