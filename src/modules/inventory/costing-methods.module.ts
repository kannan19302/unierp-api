import { Module } from "@nestjs/common";
import { CostingMethodsService } from "./services/costing-methods.service";
import { CostingMethodsController } from "./controllers/costing-methods.controller";

@Module({
  providers: [CostingMethodsService],
  controllers: [CostingMethodsController],
})
export class CostingMethodsModule {}
