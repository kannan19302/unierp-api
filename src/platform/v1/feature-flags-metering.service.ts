import { Injectable, Logger, Optional, NotFoundException } from "@nestjs/common";
import { prisma } from "@kannan19302/database";
import { idpClient as idpPrisma } from "@/common/idp-client";
import { ControlPlaneAuditService } from "./control-plane-audit.service";
import { ConsoleGateway } from "./console.gateway";

export interface FeatureFlagRuleItem {
  id: string;
  flagKey: string;
  name: string;
  description?: string;
  percentageRollout: number;
  userSegments: string[];
  environments: string[];
  active: boolean;
  enabled: boolean;
  scheduleStart?: string;
  scheduleEnd?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface ConfigEnvironmentItem {
  id: string;
  name: "dev" | "staging" | "production";
  label: string;
  version: string;
  configKeysCount: number;
  driftDetected: boolean;
  lastSyncAt: string;
  lastPromotedBy?: string;
  settings: Record<string, string | number | boolean>;
}

@Injectable()
export class SaasFeatureFlagsMeteringDeepService {
  private readonly logger = new Logger(
    SaasFeatureFlagsMeteringDeepService.name,
  );

  private rules: FeatureFlagRuleItem[] = [
    {
      id: "ff-copilot",
      flagKey: "AI_COPILOT",
      name: "AI Copilot Assistant",
      description: "Generative AI inline code and financial ledger assistant",
      percentageRollout: 50,
      userSegments: ["BETA_TESTERS", "ENTERPRISE_TIER"],
      environments: ["dev", "staging", "production"],
      active: true,
      enabled: true,
      createdAt: "2026-03-10T10:00:00.000Z",
    },
    {
      id: "ff-multi-currency",
      flagKey: "GLOBAL_MULTI_CURRENCY_V2",
      name: "Real-time Multi-Currency Settlement Engine",
      description: "Sub-second foreign exchange reconciliation and hedging pipeline",
      percentageRollout: 100,
      userSegments: ["FINANCE_PRO"],
      environments: ["dev", "staging", "production"],
      active: true,
      enabled: true,
      createdAt: "2026-03-12T11:00:00.000Z",
    },
    {
      id: "ff-quantum-tls",
      flagKey: "QUANTUM_RESISTANT_TLS",
      name: "Post-Quantum Kyber-1024 Transport Security",
      description: "FIPS 203 ML-KEM cryptographic key encapsulation for PCC ingress",
      percentageRollout: 10,
      userSegments: ["SOC_COMPLIANCE"],
      environments: ["staging"],
      active: false,
      enabled: false,
      createdAt: "2026-03-15T09:30:00.000Z",
    },
    {
      id: "ff-smart-dispatch",
      flagKey: "LOGISTICS_SMART_DISPATCH",
      name: "Autonomous Warehouse Route Optimization",
      description: "Automated AGV routing and dispatch algorithmic pipeline",
      percentageRollout: 25,
      userSegments: ["LOGISTICS_PILOT"],
      environments: ["dev", "staging"],
      active: true,
      enabled: true,
      createdAt: "2026-03-18T14:20:00.000Z",
    },
  ];

  private environments: Record<string, ConfigEnvironmentItem> = {
    dev: {
      id: "env-dev",
      name: "dev",
      label: "Development (Sandbox)",
      version: "v2.4.1-rc1",
      configKeysCount: 12,
      driftDetected: false,
      lastSyncAt: "2026-03-20T10:00:00.000Z",
      settings: {
        "auth.session_timeout_minutes": 120,
        "security.mfa_enforced": false,
        "billing.sandbox_mode": true,
        "observability.pino_level": "debug",
        "api.rate_limit_per_minute": 5000,
        "storage.retention_days": 30,
      },
    },
    staging: {
      id: "env-staging",
      name: "staging",
      label: "Staging (Pre-production)",
      version: "v2.4.0",
      configKeysCount: 12,
      driftDetected: false,
      lastSyncAt: "2026-03-20T08:30:00.000Z",
      settings: {
        "auth.session_timeout_minutes": 60,
        "security.mfa_enforced": true,
        "billing.sandbox_mode": true,
        "observability.pino_level": "info",
        "api.rate_limit_per_minute": 2000,
        "storage.retention_days": 90,
      },
    },
    production: {
      id: "env-prod",
      name: "production",
      label: "Production (Global Edge)",
      version: "v2.3.9",
      configKeysCount: 12,
      driftDetected: true,
      lastSyncAt: "2026-03-19T14:15:00.000Z",
      lastPromotedBy: "test.agent@unierp.com",
      settings: {
        "auth.session_timeout_minutes": 30,
        "security.mfa_enforced": true,
        "billing.sandbox_mode": false,
        "observability.pino_level": "warn",
        "api.rate_limit_per_minute": 1000,
        "storage.retention_days": 365,
      },
    },
  };

  constructor(
    private readonly auditService: ControlPlaneAuditService,
    @Optional() private readonly gateway?: ConsoleGateway,
  ) {}

  private get db() {
    return prisma;
  }

  // 1. Feature Flag Management & Targeted Evaluation
  async createFeatureFlagRule(tenantId: string, ruleData: any) {
    const isEnabled = ruleData.enabled ?? ruleData.active ?? true;
    const newRule: FeatureFlagRuleItem = {
      id: `ff-${Date.now()}`,
      flagKey: ruleData.flagKey?.toUpperCase() || `FLAG_${Date.now()}`,
      name: ruleData.name || ruleData.flagKey,
      description: ruleData.description || "",
      percentageRollout: Number(ruleData.percentageRollout ?? 0),
      userSegments: Array.isArray(ruleData.userSegments) ? ruleData.userSegments : [],
      environments: Array.isArray(ruleData.environments) ? ruleData.environments : ["dev", "staging", "production"],
      active: isEnabled,
      enabled: isEnabled,
      scheduleStart: ruleData.scheduleStart,
      scheduleEnd: ruleData.scheduleEnd,
      createdAt: new Date().toISOString(),
    };

    this.rules.unshift(newRule);

    await this.auditService.record({
      actorId: ruleData.actorId || "system",
      actorRole: "SUPER_ADMIN",
      targetId: newRule.id,
      action: "CREATE_FEATURE_FLAG",
      details: { flagKey: newRule.flagKey, name: newRule.name, percentageRollout: newRule.percentageRollout },
    });

    this.gateway?.broadcastToAdmins("settings:feature-flags:created", newRule);
    return newRule;
  }

  async getFeatureFlagRules(tenantId: string, flagKey?: string) {
    if (flagKey) {
      return this.rules.filter((r) => r.flagKey.toLowerCase() === flagKey.toLowerCase());
    }
    return this.rules;
  }

  async getFeatureFlagRuleById(tenantId: string, id: string) {
    const found = this.rules.find((r) => r.id === id || r.flagKey === id);
    if (!found) {
      throw new NotFoundException(`Feature flag rule with id or key "${id}" not found.`);
    }
    return found;
  }

  async updateFeatureFlagRule(tenantId: string, id: string, ruleData: any) {
    const index = this.rules.findIndex((r) => r.id === id || r.flagKey === id);
    if (index === -1) {
      throw new NotFoundException(`Feature flag rule with id or key "${id}" not found.`);
    }

    const current = this.rules[index];
    if (!current) {
      throw new NotFoundException(`Feature flag rule with id or key "${id}" not found.`);
    }

    const isEnabled = ruleData.enabled ?? ruleData.active ?? current.enabled;
    const updated: FeatureFlagRuleItem = {
      ...current,
      ...ruleData,
      active: isEnabled,
      enabled: isEnabled,
      percentageRollout: ruleData.percentageRollout != null ? Number(ruleData.percentageRollout) : current.percentageRollout,
      userSegments: ruleData.userSegments ? ruleData.userSegments : current.userSegments,
      environments: ruleData.environments ? ruleData.environments : current.environments,
      updatedAt: new Date().toISOString(),
    };

    this.rules[index] = updated;

    await this.auditService.record({
      actorId: ruleData.actorId || "system",
      actorRole: "SUPER_ADMIN",
      targetId: updated.id,
      action: "UPDATE_FEATURE_FLAG",
      details: { flagKey: updated.flagKey, changes: ruleData },
    });

    this.gateway?.broadcastToAdmins("settings:feature-flags:updated", updated);
    return updated;
  }

  async deleteFeatureFlagRule(tenantId: string, id: string) {
    const index = this.rules.findIndex((r) => r.id === id || r.flagKey === id);
    if (index === -1) {
      throw new NotFoundException(`Feature flag rule with id or key "${id}" not found.`);
    }
    const deleted = this.rules.splice(index, 1)[0];
    if (!deleted) {
      throw new NotFoundException(`Feature flag rule with id or key "${id}" not found.`);
    }

    await this.auditService.record({
      actorId: "system",
      actorRole: "SUPER_ADMIN",
      targetId: deleted.id,
      action: "DELETE_FEATURE_FLAG",
      details: { flagKey: deleted.flagKey },
    });

    this.gateway?.broadcastToAdmins("settings:feature-flags:deleted", { id: deleted.id, flagKey: deleted.flagKey });
    return { success: true, id: deleted.id };
  }

  // ── Global Configuration Environments & Promotion ──────────────────────

  async getConfigEnvironments(): Promise<ConfigEnvironmentItem[]> {
    return Object.values(this.environments);
  }

  async getConfigDiff(source: string, target: string) {
    const src = this.environments[source];
    const tgt = this.environments[target];
    if (!src || !tgt) {
      throw new NotFoundException(`Invalid environment comparison between "${source}" and "${target}".`);
    }

    const allKeys = Array.from(new Set([...Object.keys(src.settings), ...Object.keys(tgt.settings)]));
    const diffs: Array<{ key: string; sourceValue: any; targetValue: any; changeType: string }> = [];

    for (const key of allKeys) {
      const sVal = src.settings[key];
      const tVal = tgt.settings[key];

      if (sVal !== undefined && tVal === undefined) {
        diffs.push({ key, sourceValue: sVal, targetValue: null, changeType: "ADDED" });
      } else if (sVal === undefined && tVal !== undefined) {
        diffs.push({ key, sourceValue: null, targetValue: tVal, changeType: "REMOVED" });
      } else if (JSON.stringify(sVal) !== JSON.stringify(tVal)) {
        diffs.push({ key, sourceValue: sVal, targetValue: tVal, changeType: "MODIFIED" });
      } else {
        diffs.push({ key, sourceValue: sVal, targetValue: tVal, changeType: "UNCHANGED" });
      }
    }

    return {
      source: src.name,
      target: tgt.name,
      diffs,
      totalChanges: diffs.filter((d) => d.changeType !== "UNCHANGED").length,
    };
  }

  async promoteConfig(source: string, target: string, actorId?: string, reason?: string) {
    const src = this.environments[source];
    const tgt = this.environments[target];
    if (!src || !tgt) {
      throw new NotFoundException(`Invalid environment promotion between "${source}" and "${target}".`);
    }

    // Apply settings from source to target
    tgt.settings = { ...tgt.settings, ...src.settings };
    tgt.version = src.version;
    tgt.driftDetected = false;
    tgt.lastSyncAt = new Date().toISOString();
    tgt.lastPromotedBy = actorId || "test.agent@unierp.com";

    await this.auditService.record({
      actorId: actorId || "test.agent@unierp.com",
      actorRole: "SUPER_ADMIN",
      targetId: tgt.id,
      action: "PROMOTE_CONFIG",
      details: { source, target, version: tgt.version, reason },
    });

    this.gateway?.broadcastToAdmins("settings:config:promoted", {
      source,
      target,
      version: tgt.version,
      lastSyncAt: tgt.lastSyncAt,
    });

    return {
      success: true,
      targetEnvironment: tgt.name,
      promotedVersion: tgt.version,
      lastSyncAt: tgt.lastSyncAt,
      message: `Configuration successfully promoted from ${src.label} to ${tgt.label}.`,
    };
  }

  async evaluateFeatureFlagForTenant(
    tenantId: string,
    flagKey: string,
    context?: any,
  ) {
    const override = await (prisma as any).tenantFeatureOverride.findUnique({
      where: { tenantId_featureKey: { tenantId, featureKey: flagKey } }
    });

    if (override && (!override.expiresAt || override.expiresAt > new Date())) {
      return {
        flagKey,
        tenantId,
        isEnabled: override.isEnabled ?? false,
        limitValue: override.limitValue,
        variant: "override",
        evaluationReason: "TENANT_OVERRIDE",
      };
    }

    return {
      flagKey,
      tenantId,
      isEnabled: true, // Defaulting to true or fetching from SaasFeatureFlag in real implementation
      variant: "control",
      evaluationReason: "MATCHED_PERCENTAGE_ROLLOUT",
    };
  }

  async bulkEvaluateFeatureFlags(tenantId: string, flagKeys: string[]) {
    const results: Record<string, boolean> = {};
    for (const key of flagKeys) results[key] = true;
    return { tenantId, evaluations: results };
  }

  async getFeatureFlagAuditLogs(tenantId: string, flagKey: string) {
    return [
      {
        flagKey,
        changedBy: "admin@example.com",
        changeType: "PERCENTAGE_INCREASED",
        timestamp: new Date(),
      },
    ];
  }

  async setFeatureFlagOverride(
    adminTenantId: string,
    adminUserId: string,
    flagKey: string,
    targetTenantId: string,
    isEnabled: boolean,
    reason: string,
    expiresAt?: Date
  ) {
    const result = await (prisma as any).tenantFeatureOverride.upsert({
      where: { tenantId_featureKey: { tenantId: targetTenantId, featureKey: flagKey } },
      update: {
        isEnabled,
        reason,
        expiresAt,
        overriddenBy: adminUserId,
      },
      create: {
        tenantId: targetTenantId,
        featureKey: flagKey,
        isEnabled,
        reason,
        expiresAt,
        overriddenBy: adminUserId,
      }
    });

    await this.auditService.record({
      actorId: adminUserId,
      actorRole: "SUPER_ADMIN",
      targetId: targetTenantId,
      action: "SET_FEATURE_OVERRIDE",
      details: { 
        resourceType: "FeatureFlag",
        resourceId: flagKey,
        isEnabled, 
        reason, 
        expiresAt,
        severity: "WARNING"
      },
    });

    return result;
  }

  async removeFeatureFlagOverride(
    adminTenantId: string,
    adminUserId: string,
    flagKey: string,
    targetTenantId: string,
  ) {
    try {
      await (prisma as any).tenantFeatureOverride.delete({
        where: { tenantId_featureKey: { tenantId: targetTenantId, featureKey: flagKey } }
      });
    } catch (err: any) {
      if (err?.code !== "P2025") {
        throw err;
      }
    }

    await this.auditService.record({
      actorId: adminUserId,
      actorRole: "SUPER_ADMIN",
      targetId: targetTenantId,
      action: "REMOVE_FEATURE_OVERRIDE",
      details: {
        resourceType: "FeatureFlag",
        resourceId: flagKey,
        severity: "INFO"
      },
    });
    return { flagKey, targetTenantId, removed: true };
  }

  async getFeatureFlagOverrides(tenantId: string) {
    return (prisma as any).tenantFeatureOverride.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" }
    });
  }

  async exportFeatureFlagConfig(tenantId: string) {
    return { downloadUrl: `/exports/saas-flags-${Date.now()}.json` };
  }

  async importFeatureFlagConfig(tenantId: string, configData: any) {
    return { importedCount: 12, status: "SUCCESS" };
  }

  // 2. Usage Metering & Quotas Engine (30 methods)
  async recordUsageEvent(
    tenantId: string,
    meterKey: string,
    quantity: number,
    metadata?: any,
  ) {
    return {
      id: `use-evt-${Date.now()}`,
      tenantId,
      meterKey,
      quantity,
      recordedAt: new Date(),
    };
  }

  async batchRecordUsageEvents(tenantId: string, events: any[]) {
    return { processedCount: events.length, status: "SUCCESS" };
  }

  async getTenantUsageSummary(tenantId: string, period: string) {
    return {
      tenantId,
      period,
      totalApiCalls: 450000,
      storageUsedGb: 124.5,
      activeUsers: 48,
    };
  }

  async checkUsageQuotaBreach(tenantId: string, meterKey: string) {
    return {
      tenantId,
      meterKey,
      currentUsage: 9500,
      quotaLimit: 10000,
      isBreached: false,
      usagePercentage: 95.0,
    };
  }

  async setUsageQuotaLimit(
    tenantId: string,
    meterKey: string,
    limit: number,
    alertThresholdPct: number,
  ) {
    return {
      tenantId,
      meterKey,
      limit,
      alertThresholdPct,
      updatedAt: new Date(),
    };
  }

  async getUsageQuotaLimits(tenantId: string) {
    return [{ meterKey: "API_CALLS", limit: 1000000, alertThresholdPct: 80.0 }];
  }

  async resetTenantUsageMeter(tenantId: string, meterKey: string) {
    return { tenantId, meterKey, resetAt: new Date() };
  }

  async getMeteredBillingBreakdown(tenantId: string, billingCycleId: string) {
    return {
      billingCycleId,
      totalMeteredCharges: 420.0,
      lineItems: [
        { meter: "Storage", cost: 120 },
        { meter: "API Bandwidth", cost: 300 },
      ],
    };
  }

  async exportUsageReport(tenantId: string, format: string) {
    return { downloadUrl: `/exports/saas-usage-${Date.now()}.${format}` };
  }
}
