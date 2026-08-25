import { describe, it, expect, beforeEach } from "vitest";
import { MobileOperationsService } from "./mobile-operations.service";

describe("MobileOperationsService (PCC-11)", () => {
  let service: MobileOperationsService;

  beforeEach(() => {
    service = new MobileOperationsService();
  });

  it("returns dashboard metrics with channels and push provider health", async () => {
    const dashboard = await service.getDashboard();
    expect(dashboard.overview.totalBuilds).toBeGreaterThanOrEqual(4);
    expect(dashboard.channels.length).toBe(3);
    expect(dashboard.pushProviders.length).toBe(2);
    expect(dashboard.pushProviders.some((p) => p.provider === "APNs")).toBe(true);
    expect(dashboard.pushProviders.some((p) => p.provider === "FCM")).toBe(true);
  });

  it("registers a new mobile build artifact", async () => {
    const build = await service.registerBuild({
      platform: "ios",
      version: "2.6.0",
      buildNumber: 110,
      commitHash: "feed123",
      branch: "main",
      artifactSizeMb: 45.1,
    });
    expect(build.id).toContain("mob-bld-");
    expect(build.version).toBe("2.6.0");
    expect(build.status).toBe("READY");

    const all = await service.listBuilds();
    expect(all[0].buildNumber).toBe(110);
  });

  it("promotes a release channel with staged rollout percentage", async () => {
    const promoted = await service.promoteChannel({
      channel: "production",
      version: "2.5.0",
      buildNumber: 105,
      rolloutPercentage: 50,
    });
    expect(promoted.activeVersion).toBe("2.5.0");
    expect(promoted.activeBuildNumber).toBe(105);
    expect(promoted.rolloutPercentage).toBe(50);
  });

  it("updates version compatibility policy and supports emergency killswitch", async () => {
    const updated = await service.updateVersionPolicy({
      killswitchActive: true,
      minSupportedVersion: "2.3.0",
    });
    expect(updated.killswitchActive).toBe(true);
    expect(updated.minSupportedVersion).toBe("2.3.0");
  });

  it("dispatches diagnostic push notification ping", async () => {
    const ping = await service.testPushNotification({ provider: "APNs" });
    expect(ping.success).toBe(true);
    expect(ping.provider).toBe("APNs");
    expect(ping.delivered).toBe(true);
  });
});
