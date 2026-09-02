import { Module } from "@nestjs/common";
import { MarketplaceEnterpriseService } from "./services/marketplace-enterprise.service";
import { MarketplaceEnterpriseController } from "./controllers/marketplace-enterprise.controller";

@Module({
  controllers: [MarketplaceEnterpriseController],
  providers: [MarketplaceEnterpriseService],
  exports: [MarketplaceEnterpriseService],
})
export class MarketplaceEnterpriseModule {}
