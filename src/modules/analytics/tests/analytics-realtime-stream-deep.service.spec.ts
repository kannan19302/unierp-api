import { describe, it, expect, vi, beforeEach } from "vitest";
import { AnalyticsRealtimeStreamDeepService } from "../services/analytics-realtime-stream-deep.service";
import { AnalyticsRepository } from "../repositories/analytics.repository";

describe("AnalyticsRealtimeStreamDeepService", () => {
  let service: AnalyticsRealtimeStreamDeepService;
  let mockRepo: Partial<AnalyticsRepository>;

  beforeEach(() => {
    mockRepo = {
      getRecentActivityTelemetry: vi.fn(),
      getInvoiceSummary: vi.fn(),
    };
    service = new AnalyticsRealtimeStreamDeepService(
      mockRepo as AnalyticsRepository,
    );
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  describe("getLiveMetrics", () => {
    it("should return live telemetry grounded in database state", async () => {
      vi.mocked(mockRepo.getRecentActivityTelemetry!).mockResolvedValue({
        recentInvoices: [
          {
            id: "inv-abc123456",
            invoiceNumber: "INV-001",
            totalAmount: 500,
            status: "PAID",
            createdAt: new Date(),
          },
        ],
        activeEmployees: 5,
        recentAuditLogs: [{ id: "log-1" }, { id: "log-2" }],
      });

      vi.mocked(mockRepo.getInvoiceSummary!).mockResolvedValue({
        count: 7200,
        sum: 150000,
      });

      const res = await service.getLiveMetrics("t1");
      expect(res.activeUsersNow).toBe(5);
      expect(res.requestsPerSecond).toBe(3.2); // (7200 / 3600) + 1.2 = 3.2
      expect(res.activeSessions).toHaveLength(1);
      expect(res.activeSessions[0]?.activePage).toBe("/finance/invoices/INV-001");
    });
  });
});
