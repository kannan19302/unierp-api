import { Module } from "@nestjs/common";
import { EcommerceEnterpriseService } from "./services/ecommerce-enterprise.service";
import { EcommerceEnterpriseController } from "./controllers/ecommerce-enterprise.controller";

@Module({
  controllers: [EcommerceEnterpriseController],
  providers: [EcommerceEnterpriseService],
  exports: [EcommerceEnterpriseService],
})
export class EcommerceEnterpriseModule {}
