import { Module } from "@nestjs/common";
import { HealthcareEnterpriseService } from "./services/healthcare-enterprise.service";
import { HealthcareEnterpriseController } from "./controllers/healthcare-enterprise.controller";

@Module({
  controllers: [HealthcareEnterpriseController],
  providers: [HealthcareEnterpriseService],
  exports: [HealthcareEnterpriseService],
})
export class HealthcareEnterpriseModule {}
