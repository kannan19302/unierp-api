import { Module } from "@nestjs/common";
import { FieldServiceController } from "./controllers/field-service.controller";
import { FieldServiceTicketsService } from "./services/field-service-tickets.service";
import { FieldServiceDispatchService } from "./services/field-service-dispatch.service";
import { FieldServiceLogisticsService } from "./services/field-service-logistics.service";
import { FieldServiceTechMobileService } from "./services/field-service-tech-mobile.service";
import { FieldServiceSchedulingService } from "./services/field-service-scheduling.service";
import { FieldServicePartsService } from "./services/field-service-parts.service";
import { FieldServiceEnterpriseModule } from "./field-service-enterprise.module";

import { FieldServiceRepository } from "./repositories/field-service.repository";

@Module({
  imports: [FieldServiceEnterpriseModule],
  controllers: [FieldServiceController],
  providers: [
    FieldServiceRepository,
    FieldServiceTicketsService,
    FieldServiceDispatchService,
    FieldServiceLogisticsService,
    FieldServiceTechMobileService,
    FieldServiceSchedulingService,
    FieldServicePartsService,
  ],
  exports: [
    FieldServiceRepository,
    FieldServiceTicketsService,
    FieldServiceDispatchService,
    FieldServiceLogisticsService,
    FieldServiceTechMobileService,
    FieldServiceSchedulingService,
    FieldServicePartsService,
  ],
})
export class FieldServiceModule {}
