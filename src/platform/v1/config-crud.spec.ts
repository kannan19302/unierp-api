import { describe, it, expect, vi } from "vitest";
import { SaasFeatureFlagsMeteringDeepService } from "./feature-flags-metering.service";

describe("PCC-13 Global Configuration & Feature Flags Service", () => {
  const mockAudit = { record: vi.fn().mockResolvedValue(true) };
  const mockGateway = { broadcastToAdmins: vi.fn() };

  it("lists initial feature flags with realistic rollout metadata", async () => {
    const service = new SaasFeatureFlagsMeteringDeepService(mockAudit as any, mockGateway as any);
    const rules = await service.getFeatureFlagRules("tenant-1");
    expect(rules.length).toBeGreaterThanOrEqual(3);
    const copilot = rules.find((r) => r.flagKey === "AI_COPILOT");
    expect(copilot).toBeDefined();
    expect(copilot?.percentageRollout).toBe(50);
    expect(copilot?.userSegments).toContain("BETA_TESTERS");
  });

  it("creates, updates, and deletes a feature flag rule with audit records", async () => {
    const service = new SaasFeatureFlagsMeteringDeepService(mockAudit as any, mockGateway as any);
    const created = await service.createFeatureFlagRule("tenant-1", {
      flagKey: "DARK_MODE_V3",
      name: "Dark Mode Version 3",
      percentageRollout: 20,
      userSegments: ["EARLY_ADOPTERS"],
      active: true,
    });

    expect(created.id).toBeDefined();
    expect(created.flagKey).toBe("DARK_MODE_V3");
    expect(created.percentageRollout).toBe(20);
    expect(mockAudit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "CREATE_FEATURE_FLAG" }),
    );
    expect(mockGateway.broadcastToAdmins).toHaveBeenCalledWith(
      "settings:feature-flags:created",
      created,
    );

    // Update
    const updated = await service.updateFeatureFlagRule("tenant-1", created.id, {
      percentageRollout: 100,
    });
    expect(updated.percentageRollout).toBe(100);

    // Delete
    const deleted = await service.deleteFeatureFlagRule("tenant-1", created.id);
    expect(deleted.success).toBe(true);
    expect(mockGateway.broadcastToAdmins).toHaveBeenCalledWith(
      "settings:feature-flags:deleted",
      expect.objectContaining({ id: created.id }),
    );
  });

  it("lists environments and accurately computes config diff between dev and staging", async () => {
    const service = new SaasFeatureFlagsMeteringDeepService(mockAudit as any, mockGateway as any);
    const envs = await service.getConfigEnvironments();
    expect(envs.length).toBe(3);
    expect(envs.map((e) => e.name)).toEqual(["dev", "staging", "production"]);

    const diff = await service.getConfigDiff("dev", "staging");
    expect(diff.source).toBe("dev");
    expect(diff.target).toBe("staging");
    expect(diff.diffs.length).toBeGreaterThan(0);
    const timeoutDiff = diff.diffs.find((d) => d.key === "auth.session_timeout_minutes");
    expect(timeoutDiff).toBeDefined();
    expect(timeoutDiff?.changeType).toBe("MODIFIED");
  });

  it("promotes configuration from staging to production updating target version", async () => {
    const service = new SaasFeatureFlagsMeteringDeepService(mockAudit as any, mockGateway as any);
    const result = await service.promoteConfig("staging", "production", "admin@unierp.com", "Release v2.4.0 verified");

    expect(result.success).toBe(true);
    expect(result.targetEnvironment).toBe("production");
    expect(result.promotedVersion).toBe("v2.4.0");
    expect(mockAudit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "PROMOTE_CONFIG",
        details: expect.objectContaining({ source: "staging", target: "production" }),
      }),
    );
  });
});
