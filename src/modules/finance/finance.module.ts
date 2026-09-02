import { Module } from "@nestjs/common";
import { FinanceController } from "./controllers/finance.controller";
import { FinanceSettingsController } from "./controllers/settings.controller";
import { FinanceService } from "./services/finance.service";
import { FinanceEventHandler } from "./events/finance.event-handler";
import { LeaseAccountingService } from "./services/lease-accounting.service";
import { LeasesController } from "./controllers/leases.controller";
import { AppSettingsService } from "../../common/settings/settings.service";
import { FinanceDemoDataService } from "./services/finance-demo-data.service";
import { ArDeepService } from "./services/ar-deep.service";
import { ArDeepController } from "./controllers/ar-deep.controller";
import { ApDeepService } from "./services/ap-deep.service";
import { ApDeepController } from "./controllers/ap-deep.controller";
import { CloseOpsService } from "./services/close-ops.service";
import { CloseOpsController } from "./controllers/close-ops.controller";
import { ProjectAccountingService } from "./services/project-accounting.service";
import { ProjectAccountingController } from "./controllers/project-accounting.controller";
import { FinanceExpansionService } from "./services/finance-expansion.service";
import { FinanceExpansionController } from "./controllers/finance-expansion.controller";
import { FinanceOperationsService } from "./services/finance-operations.service";
import { FinanceOperationsController } from "./controllers/finance-operations.controller";
import { FinanceRepository } from "./repositories/finance.repository";
import { FinanceEnterpriseModule } from "./finance-enterprise.module";

@Module({
  imports: [FinanceEnterpriseModule],
  controllers: [
    FinanceController,
    LeasesController,
    FinanceSettingsController,
    ArDeepController,
    ApDeepController,
    CloseOpsController,
    ProjectAccountingController,
    FinanceExpansionController,
    FinanceOperationsController,
  ],
  providers: [
    FinanceRepository,
    FinanceService,
    FinanceEventHandler,
    LeaseAccountingService,
    FinanceDemoDataService,
    AppSettingsService,
    ArDeepService,
    ApDeepService,
    CloseOpsService,
    ProjectAccountingService,
    FinanceExpansionService,
    FinanceOperationsService,
  ],
  exports: [FinanceRepository, FinanceService, LeaseAccountingService, FinanceDemoDataService],
})
export class FinanceModule {}
