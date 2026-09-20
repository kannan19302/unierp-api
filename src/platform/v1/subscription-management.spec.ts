import { describe, it, expect, beforeEach, vi } from "vitest";
import { SubscriptionManagementService } from "./subscription-management.service";
import { SubscriptionManagementController } from "./subscription-management.controller";

describe("SubscriptionManagement (PCC-04)", () => {
  let service: SubscriptionManagementService;
  let controller: SubscriptionManagementController;
  let mockAudit: any;

  beforeEach(() => {
    mockAudit = {
      record: vi.fn().mockResolvedValue(true),
    };
    service = new SubscriptionManagementService(mockAudit);
    controller = new SubscriptionManagementController(service);
  });

  describe("Amendment Wizard & Proration", () => {
    it("calculates prorated costs accurately for mid-cycle plan changes", () => {
      const now = new Date();
      const periodStart = new Date(now.getTime() - 15 * 86400000); // 15 days ago
      const periodEnd = new Date(now.getTime() + 15 * 86400000);   // 15 days left (50%)
      const oldPrice = 100;
      const newPrice = 200;

      const proration = service.calculateProration(
        oldPrice,
        newPrice,
        periodStart,
        periodEnd,
        now,
      );

      // Remaining is ~50%
      expect(proration.creditAmount).toBe(50);
      expect(proration.chargeAmount).toBe(100);
      expect(proration.netAmount).toBe(50);
    });

    it("generates side-by-side plan preview with proration", async () => {
      const preview = await controller.previewAmendment("tenant-123", {
        planId: "plan-enterprise",
        billingPeriod: "MONTHLY",
        currency: "USD",
      });

      expect(preview.tenantId).toBe("tenant-123");
      expect(preview.currentPlan).toHaveProperty("name");
      expect(preview.newPlan).toHaveProperty("name");
      expect(preview.proration).toHaveProperty("netAmount");
      expect(preview.status).toBe("READY_FOR_APPROVAL");
    });
  });

  describe("Renewal Pipeline", () => {
    it("returns upcoming renewals pipeline", async () => {
      const pipeline = await controller.getRenewalPipeline();
      expect(Array.isArray(pipeline)).toBe(true);
      expect(pipeline.length).toBeGreaterThan(0);
      expect(pipeline[0]).toHaveProperty("contractValue");
      expect(pipeline[0]).toHaveProperty("renewalDate");
      expect(pipeline[0]).toHaveProperty("autoRenew");
    });

    it("toggles auto-renew for a tenant subscription", async () => {
      const req: any = { user: { id: "test-superadmin" } };
      const res = await controller.toggleAutoRenew("tenant-123", { enabled: false }, req);
      expect(res.success).toBe(true);
      expect(res.autoRenew).toBe(false);
      expect(mockAudit.record).toHaveBeenCalled();
    });

    it("extends trial period by specified days", async () => {
      const req: any = { user: { id: "test-superadmin" } };
      const res = await controller.extendTrial("tenant-123", { days: 30 }, req);
      expect(res.success).toBe(true);
      expect(res.extendedDays).toBe(30);
      expect(mockAudit.record).toHaveBeenCalled();
    });
  });
});
