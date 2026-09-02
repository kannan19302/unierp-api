import { Module } from "@nestjs/common";
import { AnalyticsEnterpriseController } from "./controllers/analytics-enterprise.controller";
import { AnalyticsEnterpriseService } from "./services/analytics-enterprise.service";

@Module({
  controllers: [AnalyticsEnterpriseController],
  providers: [AnalyticsEnterpriseService, AnalyticsEnterpriseController],
  exports: [AnalyticsEnterpriseService],
})
export class AnalyticsEnterpriseModule {}
