import { describe, it, expect, beforeEach } from "vitest";
import { PlatformDeveloperEcosystemService } from "./developer-ecosystem.service";
import { PlatformDeveloperEcosystemController } from "./developer-ecosystem.controller";

describe("PlatformDeveloperEcosystem (PCC-14 Backend)", () => {
  let service: PlatformDeveloperEcosystemService;
  let controller: PlatformDeveloperEcosystemController;

  beforeEach(() => {
    service = new PlatformDeveloperEcosystemService();
    controller = new PlatformDeveloperEcosystemController(service);
  });

  describe("Developer App Registration (EC-14.1)", () => {
    it("lists default developer apps with filter support", async () => {
      const apps = await controller.getApps();
      expect(apps.length).toBeGreaterThanOrEqual(2);
      expect(apps.some((a) => a.name.includes("Salesforce"))).toBe(true);

      const filtered = await controller.getApps("tablet", "ALL");
      expect(filtered.length).toBe(1);
      expect(filtered[0].clientType).toBe("PUBLIC");
    });

    it("registers new developer app generating client ID and plaintext secret", async () => {
      const newApp = await controller.registerApp({
        name: "Supply Chain Barcode Scanner",
        description: "Mobile handheld scanner OAuth client",
        clientType: "CONFIDENTIAL",
        ownerTenantId: "00000000-0000-0000-0000-000000000001",
        redirectUris: ["https://scanner.acme.com/oauth/callback"],
        allowedScopes: ["inventory.read", "inventory.write"],
      });

      expect(newApp.id).toBeDefined();
      expect(newApp.clientId).toMatch(/^client_/);
      expect(newApp.clientSecret).toMatch(/^secret_/);
      expect(newApp.name).toBe("Supply Chain Barcode Scanner");
      expect(newApp.status).toBe("ACTIVE");
      expect(newApp.allowedScopes).toContain("inventory.read");

      // App should now be listed
      const apps = await controller.getApps();
      expect(apps.some((a) => a.id === newApp.id)).toBe(true);
    });

    it("rotates client secret while keeping client ID intact", async () => {
      const apps = await controller.getApps();
      const target = apps[0];

      const rotation = await controller.rotateSecret(target.id);
      expect(rotation.clientId).toBe(target.clientId);
      expect(rotation.newClientSecret).toMatch(/^secret_/);
    });

    it("revokes and deletes an application", async () => {
      const apps = await controller.getApps();
      const targetId = apps[0].id;

      const res = await controller.deleteApp(targetId);
      expect(res.success).toBe(true);
      expect(res.id).toBe(targetId);

      const refreshed = await controller.getApps();
      expect(refreshed.some((a) => a.id === targetId)).toBe(false);
    });
  });

  describe("Sandbox Management (EC-14.2)", () => {
    it("lists active sandboxes with tenant scopes and expiry horizons", async () => {
      const sandboxes = await controller.getSandboxes();
      expect(sandboxes.length).toBeGreaterThanOrEqual(2);
      expect(sandboxes[0].status).toBe("PROVISIONED");
      expect(sandboxes[0].allocatedStorageMb).toBeGreaterThan(0);
    });

    it("creates an isolated developer sandbox environment", async () => {
      const created = await controller.createSandbox({
        name: "Q4 High-Volume Load Testing Sandbox",
        tenantId: "00000000-0000-0000-0000-000000000001",
        dataPreset: "FULL_ENTERPRISE_ERP",
        ttlDays: 45,
      });

      expect(created.id).toBeDefined();
      expect(created.name).toBe("Q4 High-Volume Load Testing Sandbox");
      expect(created.dataPreset).toBe("FULL_ENTERPRISE_ERP");
      expect(created.allocatedStorageMb).toBe(2048);
      expect(new Date(created.expiresAt).getTime()).toBeGreaterThan(Date.now());
    });

    it("extends sandbox expiration horizon", async () => {
      const sandboxes = await controller.getSandboxes();
      const target = sandboxes[0];
      const prevExpiry = new Date(target.expiresAt).getTime();

      const extended = await controller.extendSandbox(target.id, { days: 30 });
      const newExpiry = new Date(extended.expiresAt).getTime();
      expect(newExpiry).toBeGreaterThan(prevExpiry);
    });

    it("destroys a sandbox environment", async () => {
      const sandboxes = await controller.getSandboxes();
      const targetId = sandboxes[0].id;

      const res = await controller.destroySandbox(targetId);
      expect(res.success).toBe(true);

      const refreshed = await controller.getSandboxes();
      expect(refreshed.some((s) => s.id === targetId)).toBe(false);
    });
  });

  describe("SDK Release Management (EC-14.3)", () => {
    it("lists available multi-language SDK packages", async () => {
      const sdks = await controller.getSdks();
      expect(sdks.length).toBeGreaterThanOrEqual(4);
      expect(sdks.some((s) => s.language === "TYPESCRIPT")).toBe(true);
      expect(sdks.some((s) => s.language === "PYTHON")).toBe(true);
      expect(sdks.some((s) => s.language === "GO")).toBe(true);
    });

    it("publishes new SDK version with release notes", async () => {
      const updated = await controller.publishSdk({
        name: "@unierp/sdk-typescript",
        language: "TYPESCRIPT",
        version: "3.5.0",
        minApiVersion: "v1.3",
        releaseNotes: "Full support for WebSocket telemetry and developer ecosystem APIs.",
      });

      expect(updated.latestVersion).toBe("3.5.0");
      expect(updated.minApiVersion).toBe("v1.3");
      expect(updated.releaseNotes).toContain("WebSocket telemetry");
      expect(updated.status).toBe("ACTIVE");
    });

    it("deprecates an SDK release with scheduled sunset date", async () => {
      const sdks = await controller.getSdks();
      const target = sdks[0];

      const deprecated = await controller.deprecateSdk(target.id, { sunsetDays: 60 });
      expect(deprecated.status).toBe("DEPRECATED");
      expect(deprecated.sunsetAt).toBeDefined();
      expect(new Date(deprecated.sunsetAt!).getTime()).toBeGreaterThan(Date.now());
    });
  });
});
