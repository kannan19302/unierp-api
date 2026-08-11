import { Module } from "@nestjs/common";
import { OrgStructureController } from "./org-structure.controller";
import { OrgStructureService } from "./org-structure.service";
import { ApprovalRoutingService } from "./approval-routing.service";

@Module({
  controllers: [OrgStructureController],
  providers: [OrgStructureService, ApprovalRoutingService],
  exports: [OrgStructureService, ApprovalRoutingService],
})
export class OrgStructureModule {}
