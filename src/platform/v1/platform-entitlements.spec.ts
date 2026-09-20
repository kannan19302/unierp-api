import { describe, it, expect, beforeEach } from "vitest";
import { PlatformEntitlementsService } from "./platform-entitlements.service";
import { PlatformEntitlementsController } from "./platform-entitlements.controller";

describe("PlatformEntitlements (PCC-05)", () => {
  let service: PlatformEntitlementsService;
  let controller: PlatformEntitlementsController;

  beforeEach(() => {
    service = new PlatformEntitlementsService();
    controller = new PlatformEntitlementsController(service);
  });

  describe("License Pool Management (EC-05.1)", () => {
    it("lists seat-based license pools with allocation and utilization", async () => {
      const pools = await controller.getPools();
      expect(pools.length).toBeGreaterThanOrEqual(4);
      expect(pools[0]).toHaveProperty("totalSeats");
      expect(pools[0]).toHaveProperty("allocatedSeats");
      expect(pools[0]).toHaveProperty("availableSeats");
      expect(pools[0]).toHaveProperty("utilizationPct");
    });

    it("creates a new license pool", async () => {
      const pool = await controller.createPool({
        name: "Supply Chain Barcode Scanner Seats",
        moduleCode: "inventory-scm",
        totalSeats: 500,
        tier: "ENTERPRISE",
      });

      expect(pool.name).toBe("Supply Chain Barcode Scanner Seats");
      expect(pool.totalSeats).toBe(500);
      expect(pool.availableSeats).toBe(500);
      expect(pool.utilizationPct).toBe(0);
    });

    it("allocates seats from a pool to a tenant", async () => {
      const updated = await controller.allocateSeats("pool-core-erp", {
        tenantId: "tenant-beta",
        seatCount: 100,
      });

      expect(updated.allocatedSeats).toBe(3950);
      expect(updated.availableSeats).toBe(1050);
    });
  });

  describe("Module Grant Matrix (EC-05.2)", () => {
    it("returns module grant matrix across tenants", async () => {
      const matrix = await controller.getGrantMatrix();
      expect(matrix.length).toBeGreaterThanOrEqual(3);
      expect(matrix[0]).toHaveProperty("tenantName");
      expect(matrix[0].modules["core-erp"].enabled).toBe(true);
    });

    it("toggles module grant for a specific tenant", async () => {
      const row = await controller.toggleModuleGrant({
        tenantId: "tenant-nexus",
        moduleCode: "ai-copilot",
        enabled: true,
        effectiveDate: "2026-09-20",
      });

      expect(row.modules["ai-copilot"].enabled).toBe(true);
      expect(row.modules["ai-copilot"].effectiveDate).toBe("2026-09-20");
    });

    it("bulk enables or disables a module across all tenants", async () => {
      const res = await controller.bulkToggle({
        moduleCode: "b2b-portal",
        enabled: true,
      });

      expect(res.success).toBe(true);
      expect(res.affectedTenants).toBeGreaterThanOrEqual(3);

      const matrix = await controller.getGrantMatrix();
      expect(matrix.every((r) => r.modules["b2b-portal"].enabled)).toBe(true);
    });
  });

  describe("Offline Cryptographic License Generator (EC-05.3)", () => {
    it("generates signed cryptographic license for air-gapped environments", async () => {
      const license = await controller.generateOfflineLicense({
        tenantId: "tenant-defense-01",
        tenantName: "Defense Airgap Cell 01",
        allowedModules: ["core-erp", "finance-ledger"],
        maxSeats: 250,
        validDays: 180,
        machineFingerprint: "SHA256:abcd1234efgh5678",
      });

      expect(license.licenseKey).toMatch(/^UNIERP-LIC-/);
      expect(license.signature).toBeDefined();
      expect(license.maxSeats).toBe(250);
      expect(license.allowedModules).toContain("core-erp");
    });

    it("lists all issued offline licenses", async () => {
      const list = await controller.getOfflineLicenses();
      expect(list.length).toBeGreaterThanOrEqual(1);
      expect(list[0]).toHaveProperty("licenseKey");
    });

    it("returns active grants list", async () => {
      const grants = await controller.getActiveGrants();
      expect(Array.isArray(grants)).toBe(true);
      expect(grants.length).toBeGreaterThan(0);
      expect(grants[0]).toHaveProperty("moduleCode");
    });
  });
});
