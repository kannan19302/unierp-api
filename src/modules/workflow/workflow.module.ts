import { Module } from "@nestjs/common";
import { WorkflowController } from "./controllers/workflow.controller";
import { WorkflowService } from "./services/workflow.service";
import { WorkflowEngineService } from "./services/workflow-engine.service";
import { WorkflowEngineController } from "./controllers/workflow-engine.controller";
import { WorkflowEnterpriseModule } from "./workflow-enterprise.module";
import { WorkflowAdvancedController } from "./controllers/workflow-advanced.controller";
import { WorkflowAdvancedService } from "./services/workflow-advanced.service";
import { WorkflowExpansionController } from "./controllers/workflow-expansion.controller";
import { WorkflowExtController } from "./controllers/workflow-ext.controller";
import { WorkflowRepository } from "./repositories/workflow.repository";
import { AiClientModule } from "../../common/integrations/ai-client.module";

@Module({
  imports: [AiClientModule, WorkflowEnterpriseModule],
  controllers: [
    WorkflowController,
    WorkflowEngineController,
    WorkflowAdvancedController,
    WorkflowExpansionController,
    WorkflowExtController,
  ],
  providers: [WorkflowRepository, WorkflowService, WorkflowEngineService, WorkflowAdvancedService],
  exports: [WorkflowRepository, WorkflowService, WorkflowEngineService, WorkflowAdvancedService],
})
export class WorkflowModule {}
