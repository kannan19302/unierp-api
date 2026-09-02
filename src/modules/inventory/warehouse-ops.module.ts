import { Module } from "@nestjs/common";
import { WarehouseOpsController } from "./controllers/warehouse-ops.controller";
import { WarehouseOpsService } from "./services/warehouse-ops.service";

@Module({
  controllers: [WarehouseOpsController],
  providers: [WarehouseOpsService],
  exports: [WarehouseOpsService],
})
export class WarehouseOpsModule {}
