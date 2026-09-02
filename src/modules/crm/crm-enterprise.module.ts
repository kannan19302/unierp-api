import { Module } from "@nestjs/common";
import { CrmEnterpriseService } from "./services/crm-enterprise.service";
import { CrmEnterpriseController } from "./controllers/crm-enterprise.controller";

@Module({
  controllers: [CrmEnterpriseController],
  providers: [CrmEnterpriseService],
  exports: [CrmEnterpriseService],
})
export class CrmEnterpriseModule {}
