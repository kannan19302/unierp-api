import { describe, it, expect, beforeEach } from "vitest";
import { AppsExtensionsService } from "./apps-extensions.service";

describe("AppsExtensionsService (OCC-10)", () => {
  let service: AppsExtensionsService;
  const tenantId = "tenant-app-ext-456";

  beforeEach(() => {
    service = new AppsExtensionsService();
  });

  it("returns dashboard metrics with installed apps and recommended marketplace catalog", async () => {
    const dashboard = await service.getDashboard(tenantId);
    expect(dashboard.totalInstalled).toBeGreaterThanOrEqual(3);
    expect(dashboard.activeCount).toBeGreaterThanOrEqual(2);
    expect(dashboard.recommendedCatalog.length).toBeGreaterThanOrEqual(1);
  });

  it("installs an extension from marketplace with permission scopes", async () => {
    const installed = await service.installExtension(tenantId, {
      extensionKey: "ext-salesforce-sync",
      updateChannel: "stable",
      autoUpdate: true,
      configValues: { syncIntervalMinutes: 15 },
    });
    expect(installed.extensionKey).toBe("ext-salesforce-sync");
    expect(installed.status).toBe("ACTIVE");
    expect(installed.permissionsGranted).toContain("crm.read");

    const all = await service.listInstalled(tenantId);
    expect(all.some((e) => e.extensionKey === "ext-salesforce-sync")).toBe(true);
  });

  it("toggles extension active state between ACTIVE and PAUSED", async () => {
    const toggled = await service.toggleExtension(tenantId, "inst-01", false);
    expect(toggled.status).toBe("PAUSED");

    const resumed = await service.toggleExtension(tenantId, "inst-01", true);
    expect(resumed.status).toBe("ACTIVE");
  });

  it("upgrades an extension with pending updates", async () => {
    const upgraded = await service.updateExtension(tenantId, "inst-02");
    expect(upgraded.installedVersion).toBe(upgraded.latestVersion);
    expect(upgraded.status).toBe("ACTIVE");
  });

  it("uninstalls an extension and cleans up runtime bindings", async () => {
    const removed = await service.uninstallExtension(tenantId, "inst-03");
    expect(removed.id).toBe("inst-03");

    const all = await service.listInstalled(tenantId);
    expect(all.some((e) => e.id === "inst-03")).toBe(false);
  });
});
