import { Module } from "@nestjs/common";
import { RealEstateController } from "./controllers/real-estate.controller";
import { RealEstatePropertiesService } from "./services/real-estate-properties.service";
import { RealEstateLeasingService } from "./services/real-estate-leasing.service";
import { RealEstateOperationsService } from "./services/real-estate-operations.service";
import { RealEstateMaintenanceService } from "./services/real-estate-maintenance.service";
import { RealEstateLeaseRenewalService } from "./services/real-estate-lease-renewal.service";
import { RealEstateFinancialsService } from "./services/real-estate-financials.service";
import { RealEstateEnterpriseModule } from "./real-estate-enterprise.module";

import { RealEstateRepository } from "./repositories/real-estate.repository";

@Module({
  imports: [RealEstateEnterpriseModule],
  controllers: [RealEstateController],
  providers: [
    RealEstateRepository,
    RealEstatePropertiesService,
    RealEstateLeasingService,
    RealEstateOperationsService,
    RealEstateMaintenanceService,
    RealEstateLeaseRenewalService,
    RealEstateFinancialsService,
  ],
  exports: [
    RealEstateRepository,
    RealEstatePropertiesService,
    RealEstateLeasingService,
    RealEstateOperationsService,
    RealEstateMaintenanceService,
    RealEstateLeaseRenewalService,
    RealEstateFinancialsService,
  ],
})
export class RealEstateModule {}
