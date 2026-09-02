import { Module } from "@nestjs/common";
import { AdvancedHrController } from "./controllers/advanced-hr.controller";
import { AdvancedHrService } from "./services/advanced-hr.service";
import { PayrollTaxService } from "./services/payroll-tax.service";

import { AdvancedHrLearningPathsDeepService } from "./services/advanced-hr-learning-paths-deep.service";
import { AdvancedHrLearningPathsDeepController } from "./controllers/advanced-hr-learning-paths-deep.controller";
import { AdvancedHrSuccessionPlanningDeepService } from "./services/advanced-hr-succession-planning-deep.service";
import { AdvancedHrSuccessionPlanningDeepController } from "./controllers/advanced-hr-succession-planning-deep.controller";
import { AdvancedHrWorkforceAnalyticsDeepService } from "./services/advanced-hr-workforce-analytics-deep.service";
import { AdvancedHrWorkforceAnalyticsDeepController } from "./controllers/advanced-hr-workforce-analytics-deep.controller";
import { AdvancedHrCompensationBandsDeepService } from "./services/advanced-hr-compensation-bands-deep.service";
import { AdvancedHrCompensationBandsDeepController } from "./controllers/advanced-hr-compensation-bands-deep.controller";
import { AdvancedHrBenefitsAdminDeepService } from "./services/advanced-hr-benefits-admin-deep.service";
import { AdvancedHrBenefitsAdminDeepController } from "./controllers/advanced-hr-benefits-admin-deep.controller";
import { AdvancedHrOrgChartDeepService } from "./services/advanced-hr-org-chart-deep.service";
import { AdvancedHrOrgChartDeepController } from "./controllers/advanced-hr-org-chart-deep.controller";
import { AdvancedHrExitInterviewDeepService } from "./services/advanced-hr-exit-interview-deep.service";
import { AdvancedHrExitInterviewDeepController } from "./controllers/advanced-hr-exit-interview-deep.controller";
import { AdvancedHrWorkforceDeepService } from "./services/advanced-hr-workforce-deep.service";
import { AdvancedHrWorkforceDeepController } from "./controllers/advanced-hr-workforce-deep.controller";

import { AdvancedHrRepository } from "./repositories/advanced-hr.repository";

@Module({
  controllers: [
    AdvancedHrController,

    AdvancedHrLearningPathsDeepController,
    AdvancedHrSuccessionPlanningDeepController,
    AdvancedHrWorkforceAnalyticsDeepController,
    AdvancedHrCompensationBandsDeepController,
    AdvancedHrBenefitsAdminDeepController,
    AdvancedHrOrgChartDeepController,
    AdvancedHrExitInterviewDeepController,
    AdvancedHrWorkforceDeepController,
  ],
  providers: [
    AdvancedHrRepository,
    AdvancedHrService,
    PayrollTaxService,
    AdvancedHrLearningPathsDeepService,
    AdvancedHrSuccessionPlanningDeepService,
    AdvancedHrWorkforceAnalyticsDeepService,
    AdvancedHrCompensationBandsDeepService,
    AdvancedHrBenefitsAdminDeepService,
    AdvancedHrOrgChartDeepService,
    AdvancedHrExitInterviewDeepService,
    // Was exported without ever being provided, so Nest refused to build the
    // container: "cannot export a provider that is not part of the currently
    // processed module". The API could not start at all — invisible to the type
    // checker, and to every unit test, because module wiring is only validated
    // when the application actually boots.
    AdvancedHrWorkforceDeepService,
  ],
  exports: [
    AdvancedHrRepository,
    AdvancedHrService,
    PayrollTaxService,
    AdvancedHrLearningPathsDeepService,
    AdvancedHrSuccessionPlanningDeepService,
    AdvancedHrWorkforceAnalyticsDeepService,
    AdvancedHrCompensationBandsDeepService,
    AdvancedHrBenefitsAdminDeepService,
    AdvancedHrOrgChartDeepService,
    AdvancedHrExitInterviewDeepService,
    AdvancedHrWorkforceDeepService,
  ],
})
export class AdvancedHrModule {}
