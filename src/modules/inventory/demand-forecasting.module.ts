import { Module } from "@nestjs/common";
import { DemandForecastingController } from "./controllers/demand-forecasting.controller";
import { DemandForecastingService } from "./services/demand-forecasting.service";

@Module({
  controllers: [DemandForecastingController],
  providers: [DemandForecastingService],
})
export class DemandForecastingModule {}
