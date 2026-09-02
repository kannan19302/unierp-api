import { Module } from "@nestjs/common";
import { ManufacturingEnterpriseController } from "./controllers/manufacturing-enterprise.controller";
import { ManufacturingEnterpriseService } from "./services/manufacturing-enterprise.service";

@Module({
  controllers: [ManufacturingEnterpriseController],
  providers: [
    ManufacturingEnterpriseService,
    ManufacturingEnterpriseController,
  ],
  exports: [ManufacturingEnterpriseService],
})
export class ManufacturingEnterpriseModule {}
