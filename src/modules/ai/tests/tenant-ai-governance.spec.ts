import { describe, it, expect, beforeEach } from "vitest";
import { TenantAiGovernanceService } from "../services/tenant-ai-governance.service";

describe("TenantAiGovernanceService (OCC-21)", () => {
  let service: TenantAiGovernanceService;
  const tenantId = "tenant-ai-test-789";

  beforeEach(() => {
    service = new TenantAiGovernanceService();
  });

  it("returns AI governance dashboard with allowed models, active agents, and token budget", async () => {
    const dashboard = await service.getDashboard(tenantId);
    expect(dashboard.agents.length).toBeGreaterThanOrEqual(3);
    expect(dashboard.knowledgeSources.length).toBeGreaterThanOrEqual(3);
    expect(dashboard.allowedModels.length).toBeGreaterThanOrEqual(4);
    expect(dashboard.budget.monthlyTokenLimit).toBe(5_000_000);
  });

  it("creates a new autonomous tenant AI agent with tool grounding", async () => {
    const agent = await service.createAgent(tenantId, {
      name: "Customer Invoice Inquiry Agent",
      code: "customer-invoicing-agent",
      description: "Answers customer payment inquiries and retrieves billing history.",
      model: "mistral-large:2407",
      temperature: 0.1,
      systemPrompt: "You assist customers with invoice questions accurately.",
      toolsBound: ["query_invoices", "send_receipt_email"],
      knowledgeSourcesBound: ["ks-01"],
      allowedRoles: ["CUSTOMER_SUCCESS"],
    });

    expect(agent.id).toContain("agt-");
    expect(agent.name).toBe("Customer Invoice Inquiry Agent");
    expect(agent.status).toBe("ACTIVE");

    const all = await service.listAgents(tenantId);
    expect(all.some((a) => a.name === "Customer Invoice Inquiry Agent")).toBe(true);
  });

  it("toggles an AI agent active status", async () => {
    const paused = await service.toggleAgent(tenantId, "agt-01", false);
    expect(paused.status).toBe("PAUSED");

    const active = await service.toggleAgent(tenantId, "agt-01", true);
    expect(active.status).toBe("ACTIVE");
  });

  it("attaches a new RAG knowledge source", async () => {
    const ks = await service.attachKnowledgeSource(tenantId, {
      name: "Product Return & Refund Policy 2026",
      type: "POLICY_MANUAL",
      documentCount: 3,
      totalChunks: 420,
    });
    expect(ks.name).toBe("Product Return & Refund Policy 2026");
    expect(ks.syncStatus).toBe("READY");

    const all = await service.listKnowledgeSources(tenantId);
    expect(all.some((k) => k.name === "Product Return & Refund Policy 2026")).toBe(true);
  });

  it("runs an automated evaluation benchmark against an agent", async () => {
    const result = await service.runEvaluation(tenantId, "agt-01");
    expect(result.status).toBe("PASSED");
    expect(result.accuracyScore).toBeGreaterThanOrEqual(95);
    expect(result.safetyScore).toBe(100);
  });

  it("updates monthly token budget ceiling and hard limit thresholds", async () => {
    const budget = await service.updateBudget(tenantId, {
      monthlyTokenLimit: 10_000_000,
      costCeilingUsd: 200,
      alertThresholdPercentage: 85,
    });
    expect(budget.monthlyTokenLimit).toBe(10_000_000);
    expect(budget.costCeilingUsd).toBe(200);
    expect(budget.alertThresholdPercentage).toBe(85);
  });
});
