import { ServiceManagementGeneratedController } from "./controllers/service-management-generated.controller";
import { ServiceManagementGeneratedService } from "./services/service-management-generated.service";
import { Module } from "@nestjs/common";
import { TicketLifecycleService } from "./services/ticket-lifecycle.service";
import { SlaManagementService } from "./services/sla-management.service";
import { TicketAssignmentService } from "./services/ticket-assignment.service";
import { TicketController } from "./controllers/ticket.controller";

import { ServiceManagementRepository } from "./repositories/service-management.repository";

@Module({
  imports: [],
  providers: [
    ServiceManagementRepository,
    ServiceManagementGeneratedService,
    TicketLifecycleService,
    SlaManagementService,
    TicketAssignmentService,
  ],
  controllers: [ServiceManagementGeneratedController, TicketController],
  exports: [ServiceManagementRepository, ServiceManagementGeneratedService, TicketLifecycleService],
})
export class ServiceManagementModule {}
