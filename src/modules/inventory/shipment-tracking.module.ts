import { Module } from "@nestjs/common";
import { ShipmentTrackingService } from "./services/shipment-tracking.service";
import { ShipmentTrackingController } from "./controllers/shipment-tracking.controller";

@Module({
  providers: [ShipmentTrackingService],
  controllers: [ShipmentTrackingController],
})
export class ShipmentTrackingModule {}
