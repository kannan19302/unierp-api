import { Module } from "@nestjs/common";
import { StockTakeController } from "./controllers/stock-take.controller";
import { StockTakeService } from "./services/stock-take.service";

@Module({
  controllers: [StockTakeController],
  providers: [StockTakeService],
  exports: [StockTakeService],
})
export class StockTakeModule {}
