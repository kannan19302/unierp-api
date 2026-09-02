import { Module } from "@nestjs/common";
import { LotSerialTrackingController } from "./controllers/lot-serial-tracking.controller";
import { LotSerialTrackingService } from "./services/lot-serial-tracking.service";

@Module({
  controllers: [LotSerialTrackingController],
  providers: [LotSerialTrackingService],
  exports: [LotSerialTrackingService],
})
export class LotSerialTrackingModule {}
