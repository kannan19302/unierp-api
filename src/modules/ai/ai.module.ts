import { Module } from "@nestjs/common";
import { AiService } from "./services/ai.service";
import { AiCopilotService } from "./services/ai-copilot.service";
import { AiAgentService } from "./services/ai-agent.service";
import { AiConfigService } from "./services/ai-config.service";
import { OllamaProcessService } from "./services/ollama-process.service";
import { AgentRuntimeService } from "./services/agent-runtime.service";
import { CapabilityRegistryService } from "./services/capability-registry.service";
import { MutationApprovalService } from "./services/mutation-approval.service";
import { AiAuditService } from "./services/ai-audit.service";
import { AiController } from "./controllers/ai.controller";
import { AiAdminController } from "./controllers/ai-admin.controller";
import { AiExpansionController } from "./controllers/ai-expansion.controller";
import { AiExpansionService } from "./services/ai-expansion.service";
import { AiDeepService } from "./services/ai-deep.service";
import { AiDeepController } from "./controllers/ai-deep.controller";
import { AiEnterpriseModule } from "./ai-enterprise.module";
import { ReportingQueryClientModule } from "../../common/integrations/reporting-query-client.module";

import { TenantAiGovernanceController } from "./controllers/tenant-ai-governance.controller";
import { TenantAiGovernanceService } from "./services/tenant-ai-governance.service";

import { AiRepository } from "./repositories/ai.repository";

@Module({
  imports: [ReportingQueryClientModule, AiEnterpriseModule],
  controllers: [
    AiController,
    AiAdminController,
    AiExpansionController,
    AiDeepController,
    TenantAiGovernanceController,
  ],
  providers: [
    AiRepository,
    AiService,
    AiCopilotService,
    AiAgentService,
    AiConfigService,
    OllamaProcessService,
    AiExpansionService,
    AiDeepService,
    AgentRuntimeService,
    CapabilityRegistryService,
    MutationApprovalService,
    AiAuditService,
    TenantAiGovernanceService,
  ],
  exports: [
    AiRepository,
    AiService,
    AiCopilotService,
    AiAgentService,
    AiConfigService,
    OllamaProcessService,
    AiExpansionService,
    AiDeepService,
    AgentRuntimeService,
    CapabilityRegistryService,
    MutationApprovalService,
    AiAuditService,
    TenantAiGovernanceService,
  ],
})
export class AiModule {}
