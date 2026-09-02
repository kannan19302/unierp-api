import { Module } from "@nestjs/common";
import { HrController } from "./controllers/hr.controller";
import { HrSettingsController } from "./controllers/settings.controller";
import { HrService } from "./services/hr.service";
import { HrRepository } from "./repositories/hr.repository";
import { AppSettingsService } from "../../common/settings/settings.service";
import { HrEnterpriseModule } from "./hr-enterprise.module";
import { EmployeePiiEncryptionService } from "./services/employee-pii-encryption.service";

@Module({
  imports: [HrEnterpriseModule],
  controllers: [HrController, HrSettingsController],
  providers: [HrRepository, HrService, AppSettingsService, EmployeePiiEncryptionService],
  exports: [HrRepository, HrService, EmployeePiiEncryptionService],
})
export class HrModule {}
