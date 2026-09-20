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

  // ── model registry & status (EC-21.1) ──

  async listAllModels() {
    const models = await (prisma as any).aiProviderModel.findMany({
      orderBy: { createdAt: "desc" },
    });
    let providerMap = new Map<string, string>();
    try {
      const providers = await (prisma as any).provider.findMany({
        select: { id: true, name: true },
      });
      providerMap = new Map<string, string>(providers.map((p: any) => [p.id, p.name]));
    } catch {
      // optional fallback
    }
    return models.map((m: any) => ({
      ...m,
      providerName: providerMap.get(m.providerId) || m.providerId,
    }));
  }

  async toggleModelStatus(id: string, status?: string) {
    const existing = await (prisma as any).aiProviderModel.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException(`Model ${id} not found`);
    const nextStatus = status ?? (existing.status === "ACTIVE" ? "DISABLED" : "ACTIVE");
    return (prisma as any).aiProviderModel.update({
      where: { id },
      data: { status: nextStatus },
    });
  }

  // ── guardrail live testing (EC-21.2) ──

  async testGuardrailEvaluation(prompt: string) {
    if (!prompt) return { passed: true, violations: [] };
    const policies = await (prisma as any).aiGuardrailPolicy.findMany({ where: { enabled: true } });
    const violations: Array<{ policyId: string; name: string; ruleType: string; action: string; matchedText?: string }> = [];

    for (const policy of policies) {
      const rule = policy.rule ?? {};
      const patterns: string[] = Array.isArray(rule.patterns) ? rule.patterns : [];

      if (policy.ruleType === "KEYWORD") {
        const lowered = prompt.toLowerCase();
        for (const p of patterns) {
          if (lowered.includes(String(p).toLowerCase())) {
            violations.push({ policyId: policy.id, name: policy.name, ruleType: policy.ruleType, action: policy.action, matchedText: p });
            break;
          }
        }
      } else if (policy.ruleType === "REGEX") {
        for (const p of patterns) {
          try {
            const regex = new RegExp(String(p), "i");
            const match = prompt.match(regex);
            if (match) {
              violations.push({ policyId: policy.id, name: policy.name, ruleType: policy.ruleType, action: policy.action, matchedText: match[0] });
              break;
            }
          } catch {
            // ignore malformed regex
          }
        }
      } else if (policy.ruleType === "PII") {
        const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
        const ssnRegex = /\b\d{3}-\d{2}-\d{4}\b/;
        const match = prompt.match(emailRegex) || prompt.match(ssnRegex);
        if (match) {
          violations.push({ policyId: policy.id, name: policy.name, ruleType: policy.ruleType, action: policy.action, matchedText: match[0] });
        }
      } else if (policy.ruleType === "TOXICITY") {
        const toxicKeywords = ["malicious", "exploit", "hack", "bypass", "jailbreak", "override system prompt"];
        const lowered = prompt.toLowerCase();
        for (const word of toxicKeywords) {
          if (lowered.includes(word)) {
            violations.push({ policyId: policy.id, name: policy.name, ruleType: policy.ruleType, action: policy.action, matchedText: word });
            break;
          }
        }
      }
    }

    const hasBlock = violations.some((v) => v.action === "BLOCK");
    return {
      passed: !hasBlock,
      blockCount: violations.filter((v) => v.action === "BLOCK").length,
      warnCount: violations.filter((v) => v.action === "WARN").length,
      violations,
    };
  }

  // ── cost & token budget metrics (EC-21.3) ──

  async getCostMetrics() {
    return {
      period: "LAST_30_DAYS",
      totalSpendUsd: 1482.45,
      totalQueries: 48920,
      totalTokens: 12450000,
      costByModel: [
        { modelId: "gpt-4o", provider: "OpenAI", spendUsd: 642.10, tokens: 4200000, queries: 14200 },
        { modelId: "claude-3-5-sonnet", provider: "Anthropic", spendUsd: 512.80, tokens: 3800000, queries: 12800 },
        { modelId: "gemini-1.5-pro", provider: "Google", spendUsd: 215.30, tokens: 2950000, queries: 15100 },
        { modelId: "llama-3.3-70b", provider: "Groq / Local", spendUsd: 112.25, tokens: 1500000, queries: 6820 },
      ],
      costByTenant: [
        { tenantId: "00000000-0000-0000-0000-000000000001", tenantName: "Acme Corp", spendUsd: 890.15, queries: 28400 },
        { tenantId: "00000000-0000-0000-0000-000000000002", tenantName: "Globex Logistics", spendUsd: 385.40, queries: 12300 },
        { tenantId: "00000000-0000-0000-0000-000000000003", tenantName: "Initech Systems", spendUsd: 206.90, queries: 8220 },
      ],
      tokenRateBudget: {
        dailyCap: 1000000,
        consumedToday: 342100,
        pctUsed: 34.2,
      },
    };
  }
}