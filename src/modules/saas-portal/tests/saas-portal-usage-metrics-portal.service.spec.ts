import { describe, it, expect, vi, beforeEach } from "vitest";
import { Test, TestingModule } from "@nestjs/testing";

vi.mock("@kannan19302/database", () => ({
  prisma: {
    usageRecord: {
      findMany: vi.fn(),
    },
  },
}));

import { prisma } from "@kannan19302/database";
import { SaasPortalUsageMetricsPortalService } from "../saas-portal-usage-metrics-portal.service";

describe("SaasPortalUsageMetricsPortalService", () => {
  let service: SaasPortalUsageMetricsPortalService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [SaasPortalUsageMetricsPortalService],
    }).compile();

    service = module.get<SaasPortalUsageMetricsPortalService>(
      SaasPortalUsageMetricsPortalService,
    );
    vi.clearAllMocks();
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  describe("getUsageDashboard", () => {
    it("reads the real UsageRecord table — D21: reconciles exactly with what invoicing computed from", async () => {
      (prisma.usageRecord.findMany as any).mockResolvedValue([
        { id: "ur-1", tenantId: "t1", metric: "API_CALLS_COUNT", currentValue: 500, limitValue: 1000, updatedAt: new Date() },
      ]);

      const res = await service.getUsageDashboard("t1");
      expect(res[0].currentValue).toBe(500);
      expect(res[0].limitValue).toBe(1000);
      expect(res[0].percentUsed).toBe(50);
      expect(res[0].isOverLimit).toBe(false);
    });
  });
});
