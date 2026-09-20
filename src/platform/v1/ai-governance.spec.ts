/**
 * Unit tests for AiGovernanceService & AiGovernanceController (PCC-21)
 *
 * Verifies:
 * - EC-21.1: AI model registry, listing across providers, and operational enable/disable toggle
 * - EC-21.2: Guardrail policy creation, updating, and live prompt testing (BLOCK/WARN, KEYWORD, REGEX, PII, TOXICITY)
 * - EC-21.3: Cost tracking, token budget telemetry, and per-model / per-tenant metrics
 * - Agent registration, MCP servers, and prompt versioning
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { AiGovernanceService } from "./ai-governance.service";

let models: any[] = [];
let providers: any[] = [];
let policies: any[] = [];
let promptVersions: any[] = [];
let agents: any[] = [];
let mcpServers: any[] = [];
let ragIndexes: any[] = [];

vi.mock("@kannan19302/database", () => ({
  prisma: {
    aiProviderModel: {
      findMany: vi.fn(async () => models),
      findUnique: vi.fn(async ({ where: { id } }: any) => models.find((m) => m.id === id) ?? null),
      create: vi.fn(async ({ data }: any) => {
        const item = { id: `model-${Date.now()}`, ...data, createdAt: new Date(), updatedAt: new Date() };
        models.push(item);
        return item;
      }),
      update: vi.fn(async ({ where: { id }, data }: any) => {
        const idx = models.findIndex((m) => m.id === id);
        if (idx === -1) return null;
        models[idx] = { ...models[idx], ...data, updatedAt: new Date() };
        return models[idx];
      }),
    },
    provider: {
      findMany: vi.fn(async () => providers),
    },
    aiGuardrailPolicy: {
      findMany: vi.fn(async ({ where }: any) => {
        if (where?.enabled !== undefined) {
          return policies.filter((p) => p.enabled === where.enabled);
        }
        return policies;
      }),
      findUnique: vi.fn(async ({ where: { id } }: any) => policies.find((p) => p.id === id) ?? null),
      create: vi.fn(async ({ data }: any) => {
        const item = { id: `policy-${Date.now()}`, ...data, createdAt: new Date(), updatedAt: new Date() };
        policies.push(item);
        return item;
      }),
      update: vi.fn(async ({ where: { id }, data }: any) => {
        const idx = policies.findIndex((p) => p.id === id);
        if (idx === -1) return null;
        policies[idx] = { ...policies[idx], ...data, updatedAt: new Date() };
        return policies[idx];
      }),
    },
    aiPromptVersion: {
      findFirst: vi.fn(async ({ where: { slug } }: any) => {
        const matching = promptVersions.filter((p) => p.slug === slug);
        return matching[matching.length - 1] ?? null;
      }),
      findUnique: vi.fn(async ({ where: { id } }: any) => promptVersions.find((p) => p.id === id) ?? null),
      findMany: vi.fn(async ({ where }: any) => {
        if (where?.slug) return promptVersions.filter((p) => p.slug === where.slug);
        return promptVersions;
      }),
      create: vi.fn(async ({ data }: any) => {
        const item = { id: `prompt-${Date.now()}`, isActive: false, ...data, createdAt: new Date() };
        promptVersions.push(item);
        return item;
      }),
      updateMany: vi.fn(async ({ where: { slug }, data }: any) => {
        promptVersions.forEach((p) => {
          if (p.slug === slug) Object.assign(p, data);
        });
        return { count: promptVersions.length };
      }),
      update: vi.fn(async ({ where: { id }, data }: any) => {
        const target = promptVersions.find((p) => p.id === id);
        if (target) Object.assign(target, data);
        return target;
      }),
    },
    aiAgentRegistration: {
      findMany: vi.fn(async () => agents),
      create: vi.fn(async ({ data }: any) => {
        const item = { id: `agent-${Date.now()}`, ...data, createdAt: new Date() };
        agents.push(item);
        return item;
      }),
    },
    aiMcpServer: {
      findMany: vi.fn(async () => mcpServers),
      create: vi.fn(async ({ data }: any) => {
        const item = { id: `mcp-${Date.now()}`, ...data, createdAt: new Date() };
        mcpServers.push(item);
        return item;
      }),
    },
    aiRagIndex: {
      findMany: vi.fn(async () => ragIndexes),
      create: vi.fn(async ({ data }: any) => {
        const item = { id: `rag-${Date.now()}`, ...data, createdAt: new Date() };
        ragIndexes.push(item);
        return item;
      }),
    },
  },
}));

describe("AiGovernanceService (PCC-21)", () => {
  let service: AiGovernanceService;

  beforeEach(() => {
    models = [
      {
        id: "mod-1",
        providerId: "prov-openai",
        modelId: "gpt-4o",
        version: "2024-08-06",
        capabilities: ["chat", "vision", "tools"],
        status: "ACTIVE",
      },
      {
        id: "mod-2",
        providerId: "prov-anthropic",
        modelId: "claude-3-5-sonnet",
        version: "20241022",
        capabilities: ["chat", "code", "artifacts"],
        status: "ACTIVE",
      },
    ];

    providers = [
      { id: "prov-openai", name: "OpenAI Platform" },
      { id: "prov-anthropic", name: "Anthropic Claude" },
    ];

    policies = [
      {
        id: "pol-1",
        name: "Block Financial Exploits",
        ruleType: "KEYWORD",
        rule: { patterns: ["wire fraud", "bypass accounting audit", "shadow transaction"] },
        action: "BLOCK",
        severity: "high",
        enabled: true,
      },
      {
        id: "pol-2",
        name: "Detect PII Data",
        ruleType: "PII",
        rule: {},
        action: "WARN",
        severity: "medium",
        enabled: true,
      },
    ];

    promptVersions = [];
    agents = [];
    mcpServers = [];
    ragIndexes = [];

    service = new AiGovernanceService();
  });

  describe("EC-21.1: Multi-Model Registry", () => {
    it("lists all models mapped to provider names", async () => {
      const result = await service.listAllModels();
      expect(result).toHaveLength(2);
      expect(result[0].providerName).toBe("OpenAI Platform");
      expect(result[0].modelId).toBe("gpt-4o");
      expect(result[1].providerName).toBe("Anthropic Claude");
    });

    it("toggles model active and disabled states", async () => {
      const toggled = await service.toggleModelStatus("mod-1");
      expect(toggled.status).toBe("DISABLED");

      const reToggled = await service.toggleModelStatus("mod-1");
      expect(reToggled.status).toBe("ACTIVE");
    });
  });

  describe("EC-21.2: Guardrail Rule Editor & Evaluation", () => {
    it("creates and lists guardrail policies", async () => {
      const created = await service.createGuardrailPolicy({
        name: "No System Prompt Leak",
        ruleType: "REGEX",
        rule: { patterns: ["ignore previous instructions", "system prompt reveal"] },
        action: "BLOCK",
      });

      expect(created.id).toBeDefined();
      expect(created.name).toBe("No System Prompt Leak");

      const list = await service.listGuardrailPolicies();
      expect(list.length).toBeGreaterThanOrEqual(3);
    });

    it("evaluates live prompts and triggers BLOCK and WARN rules", async () => {
      // Safe prompt
      const safe = await service.testGuardrailEvaluation("Summarize the quarterly revenue report for Acme Corp");
      expect(safe.passed).toBe(true);
      expect(safe.violations).toHaveLength(0);

      // Prompt violating BLOCK rule
      const blocked = await service.testGuardrailEvaluation("How can I perform a wire fraud or bypass accounting audit?");
      expect(blocked.passed).toBe(false);
      expect(blocked.blockCount).toBeGreaterThan(0);
      expect(blocked.violations.some((v) => v.action === "BLOCK")).toBe(true);

      // Prompt violating PII WARN rule
      const warned = await service.testGuardrailEvaluation("Send invoices to john.doe@acmeglobal.com for verification");
      expect(warned.passed).toBe(true); // WARN does not block
      expect(warned.warnCount).toBe(1);
      expect(warned.violations[0].ruleType).toBe("PII");
    });
  });

  describe("EC-21.3: Cost Tracking & Telemetry", () => {
    it("returns aggregated cost metrics by model and tenant", async () => {
      const metrics = await service.getCostMetrics();
      expect(metrics.totalSpendUsd).toBeGreaterThan(0);
      expect(metrics.totalQueries).toBeGreaterThan(0);
      expect(metrics.totalTokens).toBeGreaterThan(0);
      expect(metrics.costByModel.length).toBeGreaterThanOrEqual(3);
      expect(metrics.costByTenant.length).toBeGreaterThanOrEqual(2);
      expect(metrics.tokenRateBudget.dailyCap).toBe(1000000);
    });
  });

  describe("Agents & Prompt Versioning", () => {
    it("registers approved agents and MCP servers", async () => {
      const agent = await service.registerAgent({
        agentKey: "agent-erp-copilot",
        name: "ERP Copilot",
        modelId: "gpt-4o",
      });
      expect(agent.agentKey).toBe("agent-erp-copilot");

      const mcp = await service.registerMcpServer({
        name: "Postgres Analytics MCP",
        endpoint: "https://mcp.internal.unierp.com/v1",
      });
      expect(mcp.name).toBe("Postgres Analytics MCP");
    });

    it("versions prompts monotonically and supports activation", async () => {
      const v1 = await service.createPromptVersion({
        name: "Invoice Extractor",
        slug: "invoice-extract",
        content: "Extract fields from invoice {{raw}}",
      });
      expect(v1.version).toBe(1);
      expect(v1.isActive).toBe(false);

      const activated = await service.activatePromptVersion(v1.id);
      expect(activated.isActive).toBe(true);
    });
  });
});
