import { Module } from "@nestjs/common";
import { CustomerReturnsController } from "./controllers/customer-returns.controller";
import { CustomerReturnsService } from "./services/customer-returns.service";

@Module({
  controllers: [CustomerReturnsController],
  providers: [CustomerReturnsService],
  exports: [CustomerReturnsService],
})
export class CustomerReturnsModule {}
