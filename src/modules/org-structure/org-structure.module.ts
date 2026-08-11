import { Module } from "@nestjs/common";
import { OrgStructureController } from "./org-structure.controller";
import { OrgStructureService } from "./org-structure.service";
import { ApprovalRoutingService } from "./approval-routing.service";
import { ApprovalChainEngineService } from "./approval-chain-engine.service";

@Module({
  controllers: [OrgStructureController],
  providers: [OrgStructureService, ApprovalRoutingService, ApprovalChainEngineService],
  exports: [OrgStructureService, ApprovalRoutingService, ApprovalChainEngineService],
})
export class OrgStructureModule {}
