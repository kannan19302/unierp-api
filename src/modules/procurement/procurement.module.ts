import { Module } from "@nestjs/common";
import { ProcurementController } from "./controllers/procurement.controller";
import { ProcurementPublicController } from "./controllers/procurement.public.controller";
import { ProcurementService } from "./services/procurement.service";
import { ContractsService } from "./services/contracts.service";
import { ContractsController } from "./controllers/contracts.controller";
import { VendorPortalService } from "./services/vendor-portal.service";

import { ProcurementExpansionController } from "./controllers/procurement-expansion.controller";
import { ProcurementIntelligenceController } from "./controllers/procurement-intelligence.controller";
import { ProcurementSchedulingController } from "./controllers/procurement-scheduling.controller";
import { SubcontractingService } from "./services/subcontracting.service";
import { DebitNotesService } from "./services/debit-notes.service";
import { VendorRmaService } from "./services/vendor-rma.service";
import { SupplierNcrCarService } from "./services/supplier-ncr-car.service";
import { RfqAuctionsService } from "./services/rfq-auctions.service";
import { PaymentSchedulesService } from "./services/payment-schedules.service";
import { SupplierScorecardService } from "./services/supplier-scorecard.service";
import { ProcurementAnalyticsService } from "./services/procurement-analytics.service";
import { ProcurementApprovalsService } from "./services/procurement-approvals.service";
import { ProcurementSourcingService } from "./services/procurement-sourcing.service";
import { ProcurementSourcingController } from "./controllers/procurement-sourcing.controller";
import { ProcurementSettingsController } from "./controllers/settings.controller";
import { ProcurementEnterpriseController } from "./controllers/procurement-enterprise.controller";
import { ProcurementEnterpriseService } from "./services/procurement-enterprise.service";
import { ProcurementRepository } from "./repositories/procurement.repository";
import { ProcurementEnterpriseModule } from "./procurement-enterprise.module";
import { SupplierPerformanceService } from "./services/supplier-performance.service";
import { ProcurementSupplierPerformanceController } from "./controllers/procurement-supplier-performance.controller";

@Module({
  imports: [ProcurementEnterpriseModule],
  controllers: [
    ProcurementController,
    ProcurementPublicController,
    ContractsController,

    ProcurementExpansionController,
    ProcurementIntelligenceController,
    ProcurementSchedulingController,
    ProcurementSourcingController,
    ProcurementSettingsController,
    ProcurementEnterpriseController,
    ProcurementSupplierPerformanceController,
  ],
  providers: [
    ProcurementRepository,
    ProcurementService,
    ContractsService,
    VendorPortalService,
    SubcontractingService,
    DebitNotesService,
    VendorRmaService,
    SupplierNcrCarService,
    RfqAuctionsService,
    PaymentSchedulesService,
    SupplierScorecardService,
    ProcurementAnalyticsService,
    ProcurementApprovalsService,
    ProcurementSourcingService,
    ProcurementEnterpriseService,
    SupplierPerformanceService,
  ],
  exports: [
    ProcurementRepository,
    ProcurementService,
    ContractsService,
    VendorPortalService,
    SubcontractingService,
    DebitNotesService,
    VendorRmaService,
    SupplierNcrCarService,
    RfqAuctionsService,
    PaymentSchedulesService,
    SupplierScorecardService,
    ProcurementAnalyticsService,
    ProcurementApprovalsService,
    ProcurementSourcingService,
    ProcurementEnterpriseService,
  ],
})
export class ProcurementModule {}
