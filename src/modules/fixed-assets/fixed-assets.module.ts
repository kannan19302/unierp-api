import { FixedAssetsGeneratedController } from "./controllers/fixed-assets-generated.controller";
import { FixedAssetsGeneratedService } from "./services/fixed-assets-generated.service";
import { Module } from "@nestjs/common";
import { FixedAssetsController } from "./controllers/fixed-assets.controller";
import { FixedAssetsDeepController } from "./controllers/fixed-assets-deep.controller";
import { FixedAssetsBulkController } from "./controllers/fixed-assets-bulk.controller";
import { FixedAssetsService } from "./services/fixed-assets.service";
import { AssetDepreciationService } from "./services/asset-depreciation.service";
import { AssetMaintenanceService } from "./services/asset-maintenance.service";
import { AssetInsuranceService } from "./services/asset-insurance.service";
import { AssetRevaluationService } from "./services/asset-revaluation.service";
import { AssetPhysicalAuditService } from "./services/asset-physical-audit.service";
import { AssetWarrantyService } from "./services/asset-warranty.service";
import { AssetComponentService } from "./services/asset-component.service";
import { AssetImpairmentService } from "./services/asset-impairment.service";
import { AssetConditionService } from "./services/asset-condition.service";
import { AssetUtilizationService } from "./services/asset-utilization.service";
import { AssetGroupService } from "./services/asset-group.service";
import { AssetBudgetService } from "./services/asset-budget.service";
import { AssetDocumentService } from "./services/asset-document.service";
import { AssetOperationsService } from "./services/asset-operations.service";

import { FixedAssetsRepository } from "./repositories/fixed-assets.repository";

@Module({
  controllers: [
    FixedAssetsGeneratedController,
    FixedAssetsController,
    FixedAssetsDeepController,
    FixedAssetsBulkController,
  ],
  providers: [
    FixedAssetsRepository,
    FixedAssetsGeneratedService,
    FixedAssetsService,
    AssetDepreciationService,
    AssetMaintenanceService,
    AssetInsuranceService,
    AssetRevaluationService,
    AssetPhysicalAuditService,
    AssetWarrantyService,
    AssetComponentService,
    AssetImpairmentService,
    AssetConditionService,
    AssetUtilizationService,
    AssetGroupService,
    AssetBudgetService,
    AssetDocumentService,
    AssetOperationsService,
  ],
  exports: [
    FixedAssetsRepository,
    FixedAssetsGeneratedService,
    FixedAssetsService,
    AssetDepreciationService,
    AssetMaintenanceService,
    AssetInsuranceService,
    AssetRevaluationService,
    AssetWarrantyService,
  ],
})
export class FixedAssetsModule {}
