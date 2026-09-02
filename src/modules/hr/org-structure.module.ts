import { Module } from "@nestjs/common";
import { OrgStructureController } from "./controllers/org-structure.controller";
import { OrgStructureService } from "./services/org-structure.service";
import { ApprovalRoutingService } from "./services/approval-routing.service";
import { ApprovalChainEngineService } from "./services/approval-chain-engine.service";

import { OrgStructureRepository } from "./repositories/org-structure.repository";

@Module({
  controllers: [OrgStructureController],
  providers: [OrgStructureRepository, OrgStructureService, ApprovalRoutingService, ApprovalChainEngineService],
  exports: [OrgStructureRepository, OrgStructureService, ApprovalRoutingService, ApprovalChainEngineService],
})
export class OrgStructureModule {}
