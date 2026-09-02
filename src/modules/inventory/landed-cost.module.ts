import { Module } from "@nestjs/common";
import { LandedCostController } from "./controllers/landed-cost.controller";
import { LandedCostService } from "./services/landed-cost.service";

@Module({
  controllers: [LandedCostController],
  providers: [LandedCostService],
  exports: [LandedCostService],
})
export class LandedCostModule {}
