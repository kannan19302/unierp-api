import { Injectable, BadRequestException } from "@nestjs/common";
import { prisma } from "@kannan19302/database";
import { idpClient as idpPrisma } from "@/common/idp-client";
import { AiService } from "./ai.service";

export interface AiConfig {
  enabled: boolean;
  model: string;
  pinnedModel: string | null;
  baseUrl: string;
}

export interface AiModelPinHistoryEntry {
  model: string | null;
  changedAt: string;
}

const SETTING_KEY = "ai.config";

/**
 * E45 exit criterion: "A model version is pinned per tenant and an
 * upgrade is a deliberate, reversible act." Previously `model` was
 * always sourced live from AiService's env-configured default, never
 * persisted — every tenant silently rode whatever model the deployment
 * environment happened to have configured, with no way to pin a known-
 * good version or roll back an upgrade for one tenant without touching
 * every other tenant's behavior. Follows the same generic-Setting
 * JSON-blob pattern as PlatformService's feature flags — no new
 * migration, one row per tenant under `Setting.key = 'ai.config'`.
 */
@Injectable()
export class AiConfigService {
  constructor(private readonly aiService: AiService) {}

  async getConfig(tenantId: string): Promise<AiConfig> {
    const setting = await prisma.setting.findUnique({
      where: { tenantId_key: { tenantId, key: SETTING_KEY } },
    });

    const stored =
      (setting?.value as Record<string, unknown> | undefined) ?? {};
    const enabled = typeof stored.enabled === "boolean" ? stored.enabled : true;
    const pinnedModel =
      typeof stored.pinnedModel === "string" ? stored.pinnedModel : null;

    return {
      enabled,
      model: pinnedModel || this.aiService.getDefaultModel(),
      pinnedModel,
      baseUrl: this.aiService.getBaseUrl(),
    };
  }

  /**
   * Pin this tenant to a specific model, or pass `null` to revert to
   * the deployment default — both directions are deliberate, explicit
   * calls, not an ambient environment change silently taking effect.
   * The pin change itself is recorded in the same setting's history
   * array so an upgrade (or rollback) is auditable, not just current
   * state.
   */
  async setModel(
    tenantId: string,
    model: string | null,
  ): Promise<AiConfig> {
    if (model !== null && model.trim() === "") {
      throw new BadRequestException(
        "Model name must be non-empty, or null to clear the pin.",
      );
    }
    const setting = await prisma.setting.findUnique({
      where: { tenantId_key: { tenantId, key: SETTING_KEY } },
    });
    const existing =
      (setting?.value as Record<string, unknown> | undefined) ?? {};
    const history = Array.isArray(existing.modelPinHistory)
      ? (existing.modelPinHistory as AiModelPinHistoryEntry[])
      : [];
    const updated = {
      ...existing,
      pinnedModel: model,
      modelPinHistory: [
        ...history,
        { model, changedAt: new Date().toISOString() },
      ],
    };

    await prisma.setting.upsert({
      where: { tenantId_key: { tenantId, key: SETTING_KEY } },
      update: { value: updated as any, category: "ai" },
      create: {
        tenantId,
        key: SETTING_KEY,
        value: updated as any,
        category: "ai",
      },
    });

    return this.getConfig(tenantId);
  }

  async getModelPinHistory(
    tenantId: string,
  ): Promise<AiModelPinHistoryEntry[]> {
    const setting = await prisma.setting.findUnique({
      where: { tenantId_key: { tenantId, key: SETTING_KEY } },
    });
    const stored =
      (setting?.value as Record<string, unknown> | undefined) ?? {};
    return Array.isArray(stored.modelPinHistory)
      ? (stored.modelPinHistory as AiModelPinHistoryEntry[])
      : [];
  }

  async setEnabled(tenantId: string, enabled: boolean): Promise<AiConfig> {
    const setting = await prisma.setting.findUnique({
      where: { tenantId_key: { tenantId, key: SETTING_KEY } },
    });
    const existing =
      (setting?.value as Record<string, unknown> | undefined) ?? {};
    const updated = { ...existing, enabled };

    await prisma.setting.upsert({
      where: { tenantId_key: { tenantId, key: SETTING_KEY } },
      update: { value: updated as any, category: "ai" },
      create: {
        tenantId,
        key: SETTING_KEY,
        value: updated as any,
        category: "ai",
      },
    });

    return this.getConfig(tenantId);
  }

  async isEnabled(tenantId: string): Promise<boolean> {
    const config = await this.getConfig(tenantId);
    return config.enabled;
  }
}
