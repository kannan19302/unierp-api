import { Injectable } from "@nestjs/common";

export interface TenantAiAgent {
  id: string;
  name: string;
  code: string;
  description: string;
  model: string;
  temperature: number;
  systemPrompt: string;
  toolsBound: string[];
  knowledgeSourcesBound: string[];
  allowedRoles: string[];
  status: "ACTIVE" | "PAUSED" | "EVALUATING";
  totalInvocations: number;
  avgLatencyMs: number;
  updatedAt: string;
}

export interface TenantKnowledgeSource {
  id: string;
  name: string;
  type: "DOCUMENT" | "DATABASE_SCHEMA" | "API_CATALOG" | "POLICY_MANUAL";
  documentCount: number;
  totalChunks: number;
  embeddingModel: string;
  lastSyncedAt: string;
  syncStatus: "READY" | "SYNCING" | "ERROR";
}

export interface TenantAiEvaluation {
  id: string;
  agentId: string;
  agentName: string;
  testCasesTotal: number;
  testCasesPassed: number;
  accuracyScore: number;
  safetyScore: number;
  latencyP95Ms: number;
  ranAt: string;
  status: "PASSED" | "FAILED" | "WARNING";
}

export interface TenantAiBudget {
  monthlyTokenLimit: number;
  tokensConsumedThisMonth: number;
  costCeilingUsd: number;
  costConsumedUsd: number;
  alertThresholdPercentage: number;
  killswitchAtLimit: boolean;
}

@Injectable()
export class TenantAiGovernanceService {
  private agents: Record<string, TenantAiAgent[]> = {};
  private knowledgeSources: Record<string, TenantKnowledgeSource[]> = {};
  private evaluations: Record<string, TenantAiEvaluation[]> = {};
  private budgets: Record<string, TenantAiBudget> = {};

  private initTenant(tenantId: string) {
    if (!this.agents[tenantId]) {
      this.agents[tenantId] = [
        {
          id: "agt-01",
          name: "Financial Statement & Audit Copilot",
          code: "fin-audit-copilot",
          description: "Analyzes balance sheets, flags variance anomalies, and prepares GAAP/IFRS notes.",
          model: "llama3.3:70b",
          temperature: 0.1,
          systemPrompt: "You are a senior financial auditor assistant. Verify arithmetic accuracy and cite GL accounts.",
          toolsBound: ["query_general_ledger", "reconcile_bank_statement", "fetch_tax_rules"],
          knowledgeSourcesBound: ["ks-01", "ks-02"],
          allowedRoles: ["FINANCE_ADMIN", "ACCOUNTANT", "CFO"],
          status: "ACTIVE",
          totalInvocations: 1240,
          avgLatencyMs: 420,
          updatedAt: new Date(Date.now() - 3600_000 * 24).toISOString(),
        },
        {
          id: "agt-02",
          name: "Procurement Vendor RFP Evaluator",
          code: "procure-evaluator",
          description: "Scores supplier bids against contractual SLA criteria, warranty terms, and pricing matrices.",
          model: "mistral-large:2407",
          temperature: 0.2,
          systemPrompt: "You evaluate vendor proposals strictly against procurement guidelines and matrix scorecards.",
          toolsBound: ["read_vendor_quote", "compare_item_pricing", "draft_vendor_clarification"],
          knowledgeSourcesBound: ["ks-03"],
          allowedRoles: ["PROCUREMENT_MANAGER", "BUYER"],
          status: "ACTIVE",
          totalInvocations: 680,
          avgLatencyMs: 650,
          updatedAt: new Date(Date.now() - 3600_000 * 48).toISOString(),
        },
        {
          id: "agt-03",
          name: "Inventory Demand & Replenishment Advisor",
          code: "inventory-replenish-advisor",
          description: "Forecasts safety stock requirements based on seasonal lead times and historical sales velocity.",
          model: "qwen2.5:72b",
          temperature: 0.2,
          systemPrompt: "You analyze SKU stock movement, warehouse capacity constraints, and suggest PO reorder points.",
          toolsBound: ["get_stock_levels", "get_sales_velocity", "create_draft_purchase_order"],
          knowledgeSourcesBound: ["ks-02"],
          allowedRoles: ["WAREHOUSE_MANAGER", "OPERATIONS_LEAD"],
          status: "ACTIVE",
          totalInvocations: 920,
          avgLatencyMs: 380,
          updatedAt: new Date(Date.now() - 3600_000 * 72).toISOString(),
        },
      ];
    }

    if (!this.knowledgeSources[tenantId]) {
      this.knowledgeSources[tenantId] = [
        {
          id: "ks-01",
          name: "Corporate Accounting Policies & Chart of Accounts",
          type: "POLICY_MANUAL",
          documentCount: 14,
          totalChunks: 1840,
          embeddingModel: "bge-large-en-v1.5",
          lastSyncedAt: new Date(Date.now() - 3600_000 * 12).toISOString(),
          syncStatus: "READY",
        },
        {
          id: "ks-02",
          name: "ERP Enterprise Data Dictionary & GL Schemas",
          type: "DATABASE_SCHEMA",
          documentCount: 8,
          totalChunks: 1220,
          embeddingModel: "bge-large-en-v1.5",
          lastSyncedAt: new Date(Date.now() - 3600_000 * 6).toISOString(),
          syncStatus: "READY",
        },
        {
          id: "ks-03",
          name: "Standard Procurement Terms & Supplier Code of Conduct",
          type: "DOCUMENT",
          documentCount: 5,
          totalChunks: 740,
          embeddingModel: "bge-large-en-v1.5",
          lastSyncedAt: new Date(Date.now() - 3600_000 * 24).toISOString(),
          syncStatus: "READY",
        },
      ];
    }

    if (!this.evaluations[tenantId]) {
      this.evaluations[tenantId] = [
        {
          id: "eval-101",
          agentId: "agt-01",
          agentName: "Financial Statement & Audit Copilot",
          testCasesTotal: 50,
          testCasesPassed: 49,
          accuracyScore: 98.0,
          safetyScore: 100.0,
          latencyP95Ms: 510,
          ranAt: new Date(Date.now() - 3600_000 * 24).toISOString(),
          status: "PASSED",
        },
        {
          id: "eval-102",
          agentId: "agt-02",
          agentName: "Procurement Vendor RFP Evaluator",
          testCasesTotal: 30,
          testCasesPassed: 29,
          accuracyScore: 96.6,
          safetyScore: 100.0,
          latencyP95Ms: 720,
          ranAt: new Date(Date.now() - 3600_000 * 48).toISOString(),
          status: "PASSED",
        },
      ];
    }

    if (!this.budgets[tenantId]) {
      this.budgets[tenantId] = {
        monthlyTokenLimit: 5_000_000,
        tokensConsumedThisMonth: 1_842_300,
        costCeilingUsd: 100.0,
        costConsumedUsd: 36.85,
        alertThresholdPercentage: 80,
        killswitchAtLimit: true,
      };
    }
  }

  async getDashboard(tenantId: string) {
    this.initTenant(tenantId);
    return {
      agents: this.agents[tenantId],
      knowledgeSources: this.knowledgeSources[tenantId],
      recentEvaluations: this.evaluations[tenantId],
      budget: this.budgets[tenantId],
      allowedModels: [
        { id: "llama3.3:70b", name: "Llama 3.3 (70B Instruct)", provider: "Ollama Local / Self-Hosted", latency: "Fast", context: "128k" },
        { id: "mistral-large:2407", name: "Mistral Large 2 (123B)", provider: "Mistral AI", latency: "Medium", context: "128k" },
        { id: "qwen2.5:72b", name: "Qwen 2.5 (72B Instruct)", provider: "Ollama Local", latency: "Fast", context: "128k" },
        { id: "deepseek-r1:70b", name: "DeepSeek R1 (70B Reasoning)", provider: "Self-Hosted Cluster", latency: "Deliberate", context: "64k" },
      ],
    };
  }

  async listAgents(tenantId: string) {
    this.initTenant(tenantId);
    return this.agents[tenantId];
  }

  async createAgent(
    tenantId: string,
    input: {
      name: string;
      code: string;
      description: string;
      model: string;
      temperature: number;
      systemPrompt: string;
      toolsBound: string[];
      knowledgeSourcesBound: string[];
      allowedRoles: string[];
    },
  ) {
    this.initTenant(tenantId);
    const newAgent: TenantAiAgent = {
      id: `agt-${Date.now()}`,
      name: input.name,
      code: input.code,
      description: input.description,
      model: input.model || "llama3.3:70b",
      temperature: input.temperature ?? 0.2,
      systemPrompt: input.systemPrompt,
      toolsBound: input.toolsBound || [],
      knowledgeSourcesBound: input.knowledgeSourcesBound || [],
      allowedRoles: input.allowedRoles || ["ADMIN"],
      status: "ACTIVE",
      totalInvocations: 0,
      avgLatencyMs: 0,
      updatedAt: new Date().toISOString(),
    };
    this.agents[tenantId]!.unshift(newAgent);
    return newAgent;
  }

  async toggleAgent(tenantId: string, id: string, enabled: boolean) {
    this.initTenant(tenantId);
    const agent = this.agents[tenantId]!.find((a) => a.id === id);
    if (!agent) throw new Error("AI Agent not found");
    agent.status = enabled ? "ACTIVE" : "PAUSED";
    agent.updatedAt = new Date().toISOString();
    return agent;
  }

  async listKnowledgeSources(tenantId: string) {
    this.initTenant(tenantId);
    return this.knowledgeSources[tenantId] || [];
  }

  async attachKnowledgeSource(
    tenantId: string,
    input: {
      name: string;
      type: "DOCUMENT" | "DATABASE_SCHEMA" | "API_CATALOG" | "POLICY_MANUAL";
      documentCount?: number;
      totalChunks?: number;
    },
  ) {
    this.initTenant(tenantId);
    const newKs: TenantKnowledgeSource = {
      id: `ks-${Date.now()}`,
      name: input.name,
      type: input.type,
      documentCount: input.documentCount || 1,
      totalChunks: input.totalChunks || 150,
      embeddingModel: "bge-large-en-v1.5",
      lastSyncedAt: new Date().toISOString(),
      syncStatus: "READY",
    };
    this.knowledgeSources[tenantId]!.push(newKs);
    return newKs;
  }

  async listEvaluations(tenantId: string) {
    this.initTenant(tenantId);
    return this.evaluations[tenantId] || [];
  }

  async runEvaluation(tenantId: string, agentId: string) {
    this.initTenant(tenantId);
    const agent = this.agents[tenantId]!.find((a) => a.id === agentId);
    if (!agent) throw new Error("AI Agent not found");

    const evaluation: TenantAiEvaluation = {
      id: `eval-${Date.now()}`,
      agentId: agent.id,
      agentName: agent.name,
      testCasesTotal: 40,
      testCasesPassed: 39,
      accuracyScore: 97.5,
      safetyScore: 100.0,
      latencyP95Ms: 440,
      ranAt: new Date().toISOString(),
      status: "PASSED",
    };
    this.evaluations[tenantId]!.unshift(evaluation);
    return evaluation;
  }

  async getBudget(tenantId: string): Promise<TenantAiBudget> {
    this.initTenant(tenantId);
    return this.budgets[tenantId]!;
  }

  async updateBudget(tenantId: string, input: Partial<TenantAiBudget>): Promise<TenantAiBudget> {
    this.initTenant(tenantId);
    const current = this.budgets[tenantId]!;
    const updated: TenantAiBudget = {
      monthlyTokenLimit: input.monthlyTokenLimit ?? current.monthlyTokenLimit,
      tokensConsumedThisMonth: input.tokensConsumedThisMonth ?? current.tokensConsumedThisMonth,
      costCeilingUsd: input.costCeilingUsd ?? current.costCeilingUsd,
      costConsumedUsd: input.costConsumedUsd ?? current.costConsumedUsd,
      alertThresholdPercentage: input.alertThresholdPercentage ?? current.alertThresholdPercentage,
      killswitchAtLimit: input.killswitchAtLimit ?? current.killswitchAtLimit,
    };
    this.budgets[tenantId] = updated;
    return updated;
  }
}
