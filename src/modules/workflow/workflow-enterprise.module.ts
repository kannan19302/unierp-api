import { Module } from "@nestjs/common";
import { WorkflowEnterpriseService } from "./services/workflow-enterprise.service";
import { WorkflowEnterpriseController } from "./controllers/workflow-enterprise.controller";

@Module({
  controllers: [WorkflowEnterpriseController],
  providers: [WorkflowEnterpriseService],
  exports: [WorkflowEnterpriseService],
})
export class WorkflowEnterpriseModule {}
