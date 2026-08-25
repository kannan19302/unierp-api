import { describe, it, expect, beforeEach } from "vitest";
import { DesktopOperationsService } from "./desktop-operations.service";

describe("DesktopOperationsService (PCC-12)", () => {
  let service: DesktopOperationsService;

  beforeEach(() => {
    service = new DesktopOperationsService();
  });

  it("returns desktop dashboard metrics with signing certificate status", async () => {
    const dashboard = await service.getDashboard();
    expect(dashboard.overview.totalBuilds).toBeGreaterThanOrEqual(4);
    expect(dashboard.channels.length).toBe(3);
    expect(dashboard.signingProfiles.length).toBe(3);
    expect(dashboard.signingProfiles.every((s) => s.status === "VALID")).toBe(true);
  });

  it("registers a new desktop installer build artifact across OS targets", async () => {
    const build = await service.registerBuild({
      targetOs: "windows-x64",
      version: "1.9.0",
      installerType: "msi",
      commitHash: "abc9876",
      sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      fileSizeBytes: 89_000_000,
    });
    expect(build.id).toContain("desk-bld-");
    expect(build.version).toBe("1.9.0");
    expect(build.signatureStatus).toBe("SIGNED_VERIFIED");

    const all = await service.listBuilds();
    expect(all[0].installerType).toBe("msi");
  });

  it("promotes an auto-update release channel", async () => {
    const promoted = await service.promoteChannel({
      channel: "stable",
      version: "1.9.0",
      rolloutPercentage: 25,
    });
    expect(promoted.activeVersion).toBe("1.9.0");
    expect(promoted.rolloutPercentage).toBe(25);
  });

  it("updates auto-download and restart policy", async () => {
    const updated = await service.updateUpdatePolicy({
      autoDownload: true,
      mandatoryRestartMinutes: 60,
      minSupportedVersion: "1.7.0",
    });
    expect(updated.mandatoryRestartMinutes).toBe(60);
    expect(updated.minSupportedVersion).toBe("1.7.0");
  });
});
