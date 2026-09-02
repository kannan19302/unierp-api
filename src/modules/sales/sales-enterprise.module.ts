import { Module } from "@nestjs/common";
import { SalesEnterpriseController } from "./controllers/sales-enterprise.controller";
import { SalesEnterpriseService } from "./services/sales-enterprise.service";

@Module({
  controllers: [SalesEnterpriseController],
  providers: [SalesEnterpriseService],
  exports: [SalesEnterpriseService],
})
export class SalesEnterpriseModule {}
