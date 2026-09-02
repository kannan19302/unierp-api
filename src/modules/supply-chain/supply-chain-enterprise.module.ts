import { Module } from "@nestjs/common";
import { SupplyChainEnterpriseController } from "./controllers/supply-chain-enterprise.controller";
import { SupplyChainEnterpriseService } from "./services/supply-chain-enterprise.service";

@Module({
  controllers: [SupplyChainEnterpriseController],
  providers: [SupplyChainEnterpriseService],
  exports: [SupplyChainEnterpriseService],
})
export class SupplyChainEnterpriseModule {}
