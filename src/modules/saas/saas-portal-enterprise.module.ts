import { Module } from "@nestjs/common";
import { SaasPortalEnterpriseService } from "./services/saas-portal-enterprise.service";
import { SaasPortalEnterpriseController } from "./controllers/saas-portal-enterprise.controller";

@Module({
  controllers: [SaasPortalEnterpriseController],
  providers: [SaasPortalEnterpriseService],
  exports: [SaasPortalEnterpriseService],
})
export class SaasPortalEnterpriseModule {}
