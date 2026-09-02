import { Module } from "@nestjs/common";
import { InventoryLogisticsController } from "./controllers/inventory-logistics.controller";
import { InventoryLogisticsService } from "./services/inventory-logistics.service";

@Module({
  controllers: [InventoryLogisticsController],
  providers: [InventoryLogisticsService],
  exports: [InventoryLogisticsService],
})
export class InventoryLogisticsModule {}
