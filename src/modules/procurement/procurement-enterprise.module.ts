import { Module } from "@nestjs/common";
import { ProcurementEnterpriseController } from "./controllers/procurement-enterprise.controller";
import { ProcurementEnterpriseService } from "./services/procurement-enterprise.service";

@Module({
  controllers: [ProcurementEnterpriseController],
  providers: [ProcurementEnterpriseService],
  exports: [ProcurementEnterpriseService],
})
export class ProcurementEnterpriseModule {}
