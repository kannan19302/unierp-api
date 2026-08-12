/**
 * E45 exit criterion: "A model version is pinned per tenant and an
 * upgrade is a deliberate, reversible act."
 *
 * AiConfigService previously always sourced `model` live from
 * AiService's env-configured default — its own comment stated
 * "per-tenant model override is explicitly out of scope." Every
 * tenant silently rode whatever model the deployment happened to have
 * configured, with no way to pin a known-good version or roll back an
 * upgrade for one tenant without changing every tenant's behavior.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

let settings: Record<string, any>;

vi.mock("@kannan19302/database", () => ({
  prisma: {
    setting: {
      findUnique: vi.fn(({ where }: any) => settings[where.tenantId_key.tenantId] ?? null),
      upsert: vi.fn(({ where, create, update }: any) => {
        const key = where.tenantId_key.tenantId;
        const existing = settings[key];
        settings[key] = existing
          ? { ...existing, ...update }
          : create;
        return settings[key];
      }),
    },
  },
}));

import { AiConfigService } from "../ai-config.service";
import { AiService } from "../ai.service";

describe("E45 · AiConfigService per-tenant model pinning", () => {
  let service: AiConfigService;
  let aiService: AiService;

  beforeEach(() => {
    vi.clearAllMocks();
    settings = {};
    process.env.OLLAMA_MODEL = "llama3.2:3b";
    aiService = new AiService();
    service = new AiConfigService(aiService);
  });

  it("returns the deployment default model when no pin has ever been set", async () => {
    const config = await service.getConfig("t1");
    expect(config.model).toBe("llama3.2:3b");
    expect(config.pinnedModel).toBeNull();
  });

  it("setModel pins the tenant to a specific model, and getConfig reflects it", async () => {
    await service.setModel("t1", "llama3.1:8b");
    const config = await service.getConfig("t1");
    expect(config.model).toBe("llama3.1:8b");
    expect(config.pinnedModel).toBe("llama3.1:8b");
  });

  it("setModel(tenantId, null) reverts the pin — an upgrade is reversible", async () => {
    await service.setModel("t1", "llama3.1:8b");
    await service.setModel("t1", null);
    const config = await service.getConfig("t1");
    expect(config.model).toBe("llama3.2:3b");
    expect(config.pinnedModel).toBeNull();
  });

  it("pinning a model for one tenant does not affect another tenant's config", async () => {
    await service.setModel("t1", "llama3.1:8b");
    const otherTenantConfig = await service.getConfig("t2");
    expect(otherTenantConfig.model).toBe("llama3.2:3b");
    expect(otherTenantConfig.pinnedModel).toBeNull();
  });

  it("records every pin change in an auditable history — an upgrade is a deliberate act, not silent", async () => {
    await service.setModel("t1", "llama3.1:8b");
    await service.setModel("t1", "llama3.2:3b");
    await service.setModel("t1", null);

    const history = await service.getModelPinHistory("t1");
    expect(history.map((h) => h.model)).toEqual([
      "llama3.1:8b",
      "llama3.2:3b",
      null,
    ]);
  });
});
