import { describe, it, expect, vi, beforeEach } from "vitest";
import { AnalyticsAnomalyDetectionDeepService } from "../services/analytics-anomaly-detection-deep.service";
import { AnalyticsRepository } from "../repositories/analytics.repository";

describe("AnalyticsAnomalyDetectionDeepService", () => {
  let service: AnalyticsAnomalyDetectionDeepService;
  let mockRepo: Partial<AnalyticsRepository>;

  beforeEach(() => {
    mockRepo = {
      findInvoicesForInsights: vi.fn().mockResolvedValue([]),
      findLowMarginProducts: vi.fn().mockResolvedValue([]),
    };
    service = new AnalyticsAnomalyDetectionDeepService(
      mockRepo as AnalyticsRepository,
    );
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  describe("getAnomalies", () => {
    it("should return empty array when no invoices exist", async () => {
      vi.mocked(mockRepo.findInvoicesForInsights!).mockResolvedValue([]);
      const res = await service.getAnomalies("t1");
      expect(res).toEqual([]);
    });

    it("should detect statistical transaction spike exceeding 2.5 sigma", async () => {
      // 10 invoices around $100, plus one extreme outlier at $10,000
      const invoices = [
        ...Array.from({ length: 10 }).map((_, i) => ({
          invoiceNumber: `INV-${i}`,
          totalAmount: 100,
          issueDate: new Date(),
          dueDate: new Date(Date.now() + 86400000),
          status: "PAID",
          paidAmount: 100,
        })),
        {
          invoiceNumber: "INV-SPIKE",
          totalAmount: 10000,
          issueDate: new Date(),
          dueDate: new Date(Date.now() + 86400000),
          status: "PAID",
          paidAmount: 10000,
        },
      ];

      vi.mocked(mockRepo.findInvoicesForInsights!).mockResolvedValue(
        invoices as never,
      );
      const res = await service.getAnomalies("t1");
      expect(res.length).toBeGreaterThan(0);
      expect(res[0]?.metric).toBe("TRANSACTION_AMOUNT_SPIKE");
      expect(["HIGH", "CRITICAL"]).toContain(res[0]?.severity);
    });
  });
});
