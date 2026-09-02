import { Module } from "@nestjs/common";
import { HealthcareController } from "./controllers/healthcare.controller";
import { HealthcareService } from "./services/healthcare.service";
import { HealthcareDeepController } from "./controllers/healthcare-deep.controller";
import { HealthcareEnterpriseModule } from "./healthcare-enterprise.module";
import { HealthcarePatientsService } from "./services/patients.service";
import { HealthcareAppointmentsService } from "./services/appointments.service";
import { HealthcarePrescriptionsService } from "./services/prescriptions.service";
import { HealthcareLabService } from "./services/lab.service";
import { HealthcareInsuranceService } from "./services/insurance.service";
import { HealthcarePharmacyService } from "./services/pharmacy.service";
import { HealthcareSchedulesService } from "./services/schedules.service";

import { HealthcareRepository } from "./repositories/healthcare.repository";

@Module({
  imports: [HealthcareEnterpriseModule],
  controllers: [HealthcareController, HealthcareDeepController],
  providers: [
    HealthcareRepository,
    HealthcareService,
    HealthcarePatientsService,
    HealthcareAppointmentsService,
    HealthcarePrescriptionsService,
    HealthcareLabService,
    HealthcareInsuranceService,
    HealthcarePharmacyService,
    HealthcareSchedulesService,
  ],
  exports: [HealthcareRepository, HealthcareService],
})
export class HealthcareModule {}
