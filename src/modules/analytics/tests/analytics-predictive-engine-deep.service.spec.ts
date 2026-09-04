import { describe, it, expect, vi, beforeEach } from "vitest";
import { AnalyticsPredictiveEngineDeepService } from "../services/analytics-predictive-engine-deep.service";
import { AnalyticsRepository } from "../repositories/analytics.repository";

describe("AnalyticsPredictiveEngineDeepService", () => {
  let service: AnalyticsPredictiveEngineDeepService;
  let mockRepo: Partial<AnalyticsRepository>;

  beforeEach(() => {
    mockRepo = {
      findPredictiveModels: vi.fn(),
      createPredictiveModel: vi.fn(),
      getHistoricalMonthlyRevenue: vi.fn(),
      createForecastRun: vi.fn(),
    };
    service = new AnalyticsPredictiveEngineDeepService(
      mockRepo as AnalyticsRepository,
    );
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  describe("trainModel", () => {
    it("should train predictive model with dynamic accuracy score based on historical data", async () => {
      vi.mocked(mockRepo.getHistoricalMonthlyRevenue!).mockResolvedValue([
        { month: "2026-01", amount: 10000 },
        { month: "2026-02", amount: 12000 },
        { month: "2026-03", amount: 15000 },
        { month: "2026-04", amount: 18000 },
        { month: "2026-05", amount: 20000 },
        { month: "2026-06", amount: 24000 },
      ]);

      const mockModel = {
        id: "pm-1",
        tenantId: "t1",
        modelName: "Revenue Model",
        algorithm: "LINEAR_REGRESSION",
        targetMetric: "REVENUE_GROWTH",
        accuracyScore: 91.2,
        status: "TRAINED",
      };

      vi.mocked(mockRepo.createPredictiveModel!).mockResolvedValue(mockModel as never);

      const res = await service.trainModel("t1", {
        modelName: "Revenue Model",
        algorithm: "LINEAR_REGRESSION",
        targetMetric: "REVENUE_GROWTH",
      });

      expect(res.accuracyScore).toBe(91.2);
      expect(mockRepo.createPredictiveModel).toHaveBeenCalledWith(
        expect.objectContaining({
          accuracyScore: 91.2,
          status: "TRAINED",
        }),
      );
    });
  });

  describe("runForecast", () => {
    it("should execute linear regression forecast with 95% confidence intervals", async () => {
      vi.mocked(mockRepo.getHistoricalMonthlyRevenue!).mockResolvedValue([
        { month: "2026-01", amount: 10000 },
        { month: "2026-02", amount: 20000 },
        { month: "2026-03", amount: 30000 },
      ]);

      vi.mocked(mockRepo.createForecastRun!).mockImplementation(
        async (data: any) => ({
          id: "run-1",
          ...data,
        }),
      );

      const res = await service.runForecast("t1", "pm-1", { forecastHorizon: "30D" });
      expect(res).toBeDefined();
      expect(mockRepo.createForecastRun).toHaveBeenCalledWith(
        expect.objectContaining({
          modelId: "pm-1",
          tenantId: "t1",
          forecastHorizon: "30D",
          resultMetrics: expect.objectContaining({
            confidenceInterval: "95%",
            forecastedValue: 40000,
            historicalPointsCount: 3,
          }),
        }),
      );
    });
  });
});
