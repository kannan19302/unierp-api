import { Module } from "@nestjs/common";
import { FinanceEnterpriseService } from "./services/finance-enterprise.service";
import { FinanceEnterpriseController } from "./controllers/finance-enterprise.controller";

@Module({
  controllers: [FinanceEnterpriseController],
  providers: [FinanceEnterpriseService],
  exports: [FinanceEnterpriseService],
})
export class FinanceEnterpriseModule {}
