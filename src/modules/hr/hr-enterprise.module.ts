import { Module } from "@nestjs/common";
import { HrEnterpriseService } from "./services/hr-enterprise.service";
import { HrEnterpriseController } from "./controllers/hr-enterprise.controller";

@Module({
  controllers: [HrEnterpriseController],
  providers: [HrEnterpriseService],
  exports: [HrEnterpriseService],
})
export class HrEnterpriseModule {}
