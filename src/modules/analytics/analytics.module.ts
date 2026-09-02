import { Module } from "@nestjs/common";
import { AnalyticsController } from "./controllers/analytics.controller";
import { AnalyticsService } from "./services/analytics.service";
import { AnalyticsExpansionController } from "./controllers/analytics-expansion.controller";
import { AnalyticsExpansionService } from "./services/analytics-expansion.service";

import { AnalyticsCustomDashboardsDeepService } from "./services/analytics-custom-dashboards-deep.service";
import { AnalyticsCustomDashboardsDeepController } from "./controllers/analytics-custom-dashboards-deep.controller";
import { AnalyticsDataPipelinesDeepService } from "./services/analytics-data-pipelines-deep.service";
import { AnalyticsDataPipelinesDeepController } from "./controllers/analytics-data-pipelines-deep.controller";
import { AnalyticsPredictiveEngineDeepService } from "./services/analytics-predictive-engine-deep.service";
import { AnalyticsPredictiveEngineDeepController } from "./controllers/analytics-predictive-engine-deep.controller";
import { AnalyticsCohortRetentionDeepService } from "./services/analytics-cohort-retention-deep.service";
import { AnalyticsCohortRetentionDeepController } from "./controllers/analytics-cohort-retention-deep.controller";
import { AnalyticsFunnelConversionDeepService } from "./services/analytics-funnel-conversion-deep.service";
import { AnalyticsFunnelConversionDeepController } from "./controllers/analytics-funnel-conversion-deep.controller";
import { AnalyticsRealtimeStreamDeepService } from "./services/analytics-realtime-stream-deep.service";
import { AnalyticsRealtimeStreamDeepController } from "./controllers/analytics-realtime-stream-deep.controller";
import { AnalyticsAnomalyDetectionDeepService } from "./services/analytics-anomaly-detection-deep.service";
import { AnalyticsAnomalyDetectionDeepController } from "./controllers/analytics-anomaly-detection-deep.controller";
import { AnalyticsDeepService } from "./services/analytics-deep.service";
import { AnalyticsDeepController } from "./controllers/analytics-deep.controller";
import { AnalyticsEnterpriseModule } from "./analytics-enterprise.module";
import { AnalyticsEnterpriseController } from "./controllers/analytics-enterprise.controller";
import { AnalyticsEnterpriseService } from "./services/analytics-enterprise.service";

import { AnalyticsRepository } from "./repositories/analytics.repository";

@Module({
  imports: [AnalyticsEnterpriseModule],
  controllers: [
    AnalyticsController,
    AnalyticsExpansionController,
    AnalyticsCustomDashboardsDeepController,
    AnalyticsDataPipelinesDeepController,
    AnalyticsPredictiveEngineDeepController,
    AnalyticsCohortRetentionDeepController,
    AnalyticsFunnelConversionDeepController,
    AnalyticsRealtimeStreamDeepController,
    AnalyticsAnomalyDetectionDeepController,
    AnalyticsDeepController,
    AnalyticsEnterpriseController,
  ],
  providers: [
    AnalyticsRepository,
    AnalyticsService,
    AnalyticsExpansionService,
    AnalyticsCustomDashboardsDeepService,
    AnalyticsDataPipelinesDeepService,
    AnalyticsPredictiveEngineDeepService,
    AnalyticsCohortRetentionDeepService,
    AnalyticsFunnelConversionDeepService,
    AnalyticsRealtimeStreamDeepService,
    AnalyticsAnomalyDetectionDeepService,
    AnalyticsDeepService,
    AnalyticsEnterpriseService,
    AnalyticsEnterpriseController,
  ],
  exports: [
    AnalyticsRepository,
    AnalyticsService,
    AnalyticsExpansionService,
    AnalyticsCustomDashboardsDeepService,
    AnalyticsDataPipelinesDeepService,
    AnalyticsPredictiveEngineDeepService,
    AnalyticsCohortRetentionDeepService,
    AnalyticsFunnelConversionDeepService,
    AnalyticsRealtimeStreamDeepService,
    AnalyticsAnomalyDetectionDeepService,
    AnalyticsDeepService,
    AnalyticsEnterpriseService,
  ],
})
export class AnalyticsModule {}
