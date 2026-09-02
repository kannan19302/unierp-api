import { Module } from "@nestjs/common";
import { StockValuationController } from "./controllers/stock-valuation.controller";
import { StockValuationService } from "./services/stock-valuation.service";

@Module({
  controllers: [StockValuationController],
  providers: [StockValuationService],
  exports: [StockValuationService],
})
export class StockValuationModule {}
