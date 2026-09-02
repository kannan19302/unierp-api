import { Module } from "@nestjs/common";
import { HrAdvancedController } from "./controllers/hr-advanced.controller";
import { HrAdvancedService } from "./services/hr-advanced.service";
import { HrTalentController } from "./controllers/hr-talent.controller";
import { HrTalentService } from "./services/hr-talent.service";
import { HrCompensationController } from "./controllers/hr-compensation.controller";
import { HrCompensationService } from "./services/hr-compensation.service";
import { HrOperationsController } from "./controllers/hr-operations.controller";
import { HrOperationsService } from "./services/hr-operations.service";
import { HrExperienceController } from "./controllers/hr-experience.controller";
import { HrExperienceService } from "./services/hr-experience.service";
import { HrWorkforceAnalyticsDeepService } from "./services/hr-workforce-analytics-deep.service";
import { HrWorkforceAnalyticsDeepController } from "./controllers/hr-workforce-analytics-deep.controller";
import { HrGlobalPayrollDeepService } from "./services/hr-global-payroll-deep.service";
import { HrGlobalPayrollDeepController } from "./controllers/hr-global-payroll-deep.controller";
import { HrTalentAcquisitionDeepService } from "./services/hr-talent-acquisition-deep.service";
import { HrTalentAcquisitionDeepController } from "./controllers/hr-talent-acquisition-deep.controller";
import { HrPerformanceAppraisalsDeepService } from "./services/hr-performance-appraisals-deep.service";
import { HrPerformanceAppraisalsDeepController } from "./controllers/hr-performance-appraisals-deep.controller";
import { HrBenefitsAdministrationDeepService } from "./services/hr-benefits-administration-deep.service";
import { HrBenefitsAdministrationDeepController } from "./controllers/hr-benefits-administration-deep.controller";
import { HrTimeAttendanceDeepService } from "./services/hr-time-attendance-deep.service";
import { HrTimeAttendanceDeepController } from "./controllers/hr-time-attendance-deep.controller";
import { HrComplianceSafetyDeepService } from "./services/hr-compliance-safety-deep.service";
import { HrComplianceSafetyDeepController } from "./controllers/hr-compliance-safety-deep.controller";
import { HrOrgChartSuccessionDeepService } from "./services/hr-org-chart-succession-deep.service";
import { HrOrgChartSuccessionDeepController } from "./controllers/hr-org-chart-succession-deep.controller";

import { HrAdvancedRepository } from "./repositories/hr-advanced.repository";

// ── New Deep Feature Packs (Phase 2 — Push HR to 1500+) ──
@Module({
  controllers: [
    HrAdvancedController,
    HrTalentController,
    HrCompensationController,
    HrOperationsController,
    HrExperienceController,
    HrWorkforceAnalyticsDeepController,
    HrGlobalPayrollDeepController,
    HrTalentAcquisitionDeepController,
    HrPerformanceAppraisalsDeepController,
    HrBenefitsAdministrationDeepController,
    HrTimeAttendanceDeepController,
    HrComplianceSafetyDeepController,
    HrOrgChartSuccessionDeepController,
    // Phase 2 Deep Feature Packs
  ],
  providers: [
    HrAdvancedRepository,
    HrAdvancedService,
    HrTalentService,
    HrCompensationService,
    HrOperationsService,
    HrExperienceService,
    HrWorkforceAnalyticsDeepService,
    HrGlobalPayrollDeepService,
    HrTalentAcquisitionDeepService,
    HrPerformanceAppraisalsDeepService,
    HrBenefitsAdministrationDeepService,
    HrTimeAttendanceDeepService,
    HrComplianceSafetyDeepService,
    HrOrgChartSuccessionDeepService,
    // Phase 2 Deep Feature Packs
  ],
  exports: [
    HrAdvancedRepository,
    HrAdvancedService,
    HrTalentService,
    HrCompensationService,
    HrOperationsService,
    HrExperienceService,
    HrWorkforceAnalyticsDeepService,
    HrGlobalPayrollDeepService,
    HrTalentAcquisitionDeepService,
    HrPerformanceAppraisalsDeepService,
    HrBenefitsAdministrationDeepService,
    HrTimeAttendanceDeepService,
    HrComplianceSafetyDeepService,
    HrOrgChartSuccessionDeepService,
    // Phase 2 Deep Feature Packs
  ],
})
export class HrAdvancedModule {}
