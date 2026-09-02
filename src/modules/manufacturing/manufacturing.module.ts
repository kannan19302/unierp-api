import { Module } from "@nestjs/common";
import { ManufacturingController } from "./controllers/manufacturing.controller";
import { ManufacturingService } from "./services/manufacturing.service";
import { SchedulingService } from "./services/scheduling.service";
import { SchedulingController } from "./controllers/scheduling.controller";
import { ManufacturingExpansionController } from "./controllers/manufacturing-expansion.controller";
import { ManufacturingExpansionService } from "./services/manufacturing-expansion.service";
import { ManufacturingSettingsController } from "./controllers/settings.controller";
import { ManufacturingAdvancedQualityService } from "./services/manufacturing-advanced-quality.service";
import { ManufacturingAdvancedQualityController } from "./controllers/manufacturing-advanced-quality.controller";
import { ManufacturingToolingService } from "./services/manufacturing-tooling.service";
import { ManufacturingToolingController } from "./controllers/manufacturing-tooling.controller";
import { ManufacturingApsService } from "./services/manufacturing-aps.service";
import { ManufacturingApsController } from "./controllers/manufacturing-aps.controller";
import { ManufacturingEnergyService } from "./services/manufacturing-energy.service";
import { ManufacturingEnergyController } from "./controllers/manufacturing-energy.controller";
import { ManufacturingLeanService } from "./services/manufacturing-lean.service";
import { ManufacturingLeanController } from "./controllers/manufacturing-lean.controller";
import { ManufacturingTpmService } from "./services/manufacturing-tpm.service";
import { ManufacturingTpmController } from "./controllers/manufacturing-tpm.controller";
import { ManufacturingContractMfgService } from "./services/manufacturing-contract-mfg.service";
import { ManufacturingContractMfgController } from "./controllers/manufacturing-contract-mfg.controller";
import { ManufacturingDdmrpService } from "./services/manufacturing-ddmrp.service";
import { ManufacturingDdmrpController } from "./controllers/manufacturing-ddmrp.controller";

import { MfgDeepExpansionController } from "./controllers/mfg-deep-expansion.controller";
import { MfgDeepExpansionService } from "./services/mfg-deep-expansion.service";
import { ManufacturingEnterpriseModule } from "./manufacturing-enterprise.module";
import { ManufacturingEnterpriseController } from "./controllers/manufacturing-enterprise.controller";
import { ManufacturingEnterpriseService } from "./services/manufacturing-enterprise.service";
import { ManufacturingMpsService } from "./services/manufacturing-mps.service";
import { ManufacturingMpsController } from "./controllers/manufacturing-mps.controller";
import { ManufacturingJobCostService } from "./services/manufacturing-job-cost.service";
import { ManufacturingJobCostController } from "./controllers/manufacturing-job-cost.controller";

import { ManufacturingRepository } from "./repositories/manufacturing.repository";

@Module({
  imports: [ManufacturingEnterpriseModule],
  controllers: [
    ManufacturingController,
    SchedulingController,
    ManufacturingExpansionController,
    ManufacturingSettingsController,
    ManufacturingAdvancedQualityController,
    ManufacturingToolingController,
    ManufacturingApsController,
    ManufacturingEnergyController,
    ManufacturingLeanController,
    ManufacturingTpmController,
    ManufacturingContractMfgController,
    ManufacturingDdmrpController,
    ManufacturingEnterpriseController,
    MfgDeepExpansionController,
    ManufacturingMpsController,
    ManufacturingJobCostController,
  ],
  providers: [
    ManufacturingRepository,
    ManufacturingService,
    SchedulingService,
    ManufacturingExpansionService,
    ManufacturingAdvancedQualityService,
    ManufacturingToolingService,
    ManufacturingApsService,
    ManufacturingEnergyService,
    ManufacturingLeanService,
    ManufacturingTpmService,
    ManufacturingContractMfgService,
    ManufacturingDdmrpService,
    ManufacturingEnterpriseService,
    ManufacturingEnterpriseController,
    MfgDeepExpansionService,
    ManufacturingMpsService,
    ManufacturingJobCostService,
  ],
  exports: [
    ManufacturingRepository,
    ManufacturingService,
    SchedulingService,
    ManufacturingExpansionService,
    ManufacturingEnterpriseService,
    MfgDeepExpansionService,
    ManufacturingMpsService,
    ManufacturingJobCostService,
  ],
})
export class ManufacturingModule {}
