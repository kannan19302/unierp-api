import { Module } from "@nestjs/common";
import { TransferOrdersController } from "./controllers/transfer-orders.controller";
import { TransferOrdersService } from "./services/transfer-orders.service";

@Module({
  controllers: [TransferOrdersController],
  providers: [TransferOrdersService],
  exports: [TransferOrdersService],
})
export class TransferOrdersModule {}
