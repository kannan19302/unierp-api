import { Module } from "@nestjs/common";
import { QualityComplianceController } from "./controllers/quality-compliance.controller";
import { QualityComplianceService } from "./services/quality-compliance.service";

@Module({
  controllers: [QualityComplianceController],
  providers: [QualityComplianceService],
  exports: [QualityComplianceService],
})
export class QualityComplianceModule {}
