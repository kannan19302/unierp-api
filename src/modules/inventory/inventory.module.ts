import { Module } from "@nestjs/common";
import { InventoryController } from "./controllers/inventory.controller";
import { InventoryService } from "./services/inventory.service";
import { InventoryWarehousesService } from "./services/inventory-warehouses.service";
import { InventoryProductsService } from "./services/inventory-products.service";
import { InventoryQaService } from "./services/inventory-qa.service";
import { InventoryEventHandler } from "./events/inventory.event-handler";
import { CostingService } from "./services/costing.service";
import { CostingController } from "./controllers/costing.controller";
import { InventoryRepository } from "./repositories/inventory.repository";
import { InventoryEnterpriseModule } from "./inventory-enterprise.module";

import { RtvService } from "./services/rtv.service";
import { RtvController } from "./controllers/rtv.controller";
import { InventoryLaborService } from "./services/inventory-labor.service";
import { InventoryLaborController } from "./controllers/inventory-labor.controller";
import { SupplierQualityService } from "./services/supplier-quality.service";
import { SupplierQualityController } from "./controllers/supplier-quality.controller";
import { InventoryAutomationService } from "./services/inventory-automation.service";
import { InventoryAutomationController } from "./controllers/inventory-automation.controller";
import { InventoryAnalyticsService } from "./services/inventory-analytics.service";
import { InventoryAnalyticsController } from "./controllers/inventory-analytics.controller";
import { InventoryRmaService } from "./services/inventory-rma.service";
import { InventoryRmaController } from "./controllers/inventory-rma.controller";
import { InventoryWavePlanningService } from "./services/inventory-wave-planning.service";
import { InventoryWavePlanningController } from "./controllers/inventory-wave-planning.controller";
import { InventoryWarehouseSlottingDeepService } from "./services/inventory-warehouse-slotting-deep.service";
import { InventoryWarehouseSlottingDeepController } from "./controllers/inventory-warehouse-slotting-deep.controller";
import { InventoryLpnTrackingDeepService } from "./services/inventory-lpn-tracking-deep.service";
import { InventoryLpnTrackingDeepController } from "./controllers/inventory-lpn-tracking-deep.controller";
import { InventorySerialBatchGenealogyDeepService } from "./services/inventory-serial-batch-genealogy-deep.service";
import { InventorySerialBatchGenealogyDeepController } from "./controllers/inventory-serial-batch-genealogy-deep.controller";
import { InventoryCycleCountingDeepService } from "./services/inventory-cycle-counting-deep.service";
import { InventoryCycleCountingDeepController } from "./controllers/inventory-cycle-counting-deep.controller";
// Phase 2 — Deep Feature Packs (Push Inventory to 1500+)

@Module({
  imports: [InventoryEnterpriseModule],
  controllers: [
    InventoryController,
    CostingController,
    RtvController,
    InventoryLaborController,
    SupplierQualityController,
    InventoryAutomationController,
    InventoryAnalyticsController,
    InventoryRmaController,
    InventoryWavePlanningController,
    InventoryWarehouseSlottingDeepController,
    InventoryLpnTrackingDeepController,
    InventorySerialBatchGenealogyDeepController,
    InventoryCycleCountingDeepController,
  ],
  providers: [
    InventoryRepository,
    InventoryService,
    InventoryWarehousesService,
    InventoryProductsService,
    InventoryQaService,
    InventoryEventHandler,
    CostingService,
    RtvService,
    InventoryLaborService,
    SupplierQualityService,
    InventoryAutomationService,
    InventoryAnalyticsService,
    InventoryRmaService,
    InventoryWavePlanningService,
    InventoryWarehouseSlottingDeepService,
    InventoryLpnTrackingDeepService,
    InventorySerialBatchGenealogyDeepService,
    InventoryCycleCountingDeepService,
  ],
  exports: [
    InventoryRepository,
    InventoryService,
    InventoryWarehousesService,
    InventoryProductsService,
    InventoryQaService,
    CostingService,
    RtvService,
    InventoryLaborService,
    SupplierQualityService,
    InventoryAutomationService,
    InventoryAnalyticsService,
    InventoryRmaService,
    InventoryWavePlanningService,
    InventoryWarehouseSlottingDeepService,
    InventoryLpnTrackingDeepService,
    InventorySerialBatchGenealogyDeepService,
    InventoryCycleCountingDeepService,
  ],
})
export class InventoryModule {}
