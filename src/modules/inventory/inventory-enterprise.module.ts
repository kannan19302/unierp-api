import { Module } from "@nestjs/common";
import { InventoryEnterpriseService } from "./services/inventory-enterprise.service";
import { InventoryEnterpriseController } from "./controllers/inventory-enterprise.controller";

@Module({
  controllers: [InventoryEnterpriseController],
  providers: [InventoryEnterpriseService],
  exports: [InventoryEnterpriseService],
})
export class InventoryEnterpriseModule {}
