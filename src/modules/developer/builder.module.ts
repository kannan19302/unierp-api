import { Module } from "@nestjs/common";
import { BuilderController } from "./controllers/builder.controller";
import { BuilderService } from "./services/builder.service";
import { WebCollectionsService } from "./services/web-collections.service";
import { WebPublicController } from "./controllers/web-public.controller";
import { WebStudioController } from "./controllers/web-studio.controller";
import { WebStudioService } from "./services/web-studio.service";
import { BuilderGovernanceService } from "./services/builder-governance.service";
import { BuilderScriptingService } from "./services/builder-scripting.service";
import { BuilderAiService } from "./services/builder-ai.service";
import { GovernanceController } from "./controllers/governance.controller";
import { AiClientModule } from "../../common/integrations/ai-client.module";
// P4 — the legacy builder services now read module composition from the real
// tables via ModuleCompositionService instead of builder_modules' JSON
// columns. No cycle: DeveloperPlatformModule does not import this one.
import { DeveloperPlatformModule } from "./developer-platform.module";

// Decomposed Sub-services
import { BuilderFormsService } from "./services/builder-forms.service";
import { BuilderWorkflowsService } from "./services/builder-workflows.service";
import { BuilderWorkflowRuntimeService } from "./services/builder-workflow-runtime.service";
import { BuilderStatsService } from "./services/builder-stats.service";
import { BuilderDashboardsService } from "./services/builder-dashboards.service";
import { BuilderDevOpsService } from "./services/builder-devops.service";
import { BuilderWebContentService } from "./services/builder-web-content.service";
import { BuilderExpansionController } from "./controllers/builder-expansion.controller";
import { BuilderExpansionService } from "./services/builder-expansion.service";

// Feature Pack Services
import { BuilderAdvancedFormsService } from "./services/builder-advanced-forms.service";
import { BuilderBpmnService } from "./services/builder-bpmn.service";
import { BuilderApiService } from "./services/builder-api.service";
import { BuilderRulesService } from "./services/builder-rules.service";
import { BuilderEtlService } from "./services/builder-etl.service";
import { BuilderMobileService } from "./services/builder-mobile.service";
import { BuilderThemeService } from "./services/builder-theme.service";
import { BuilderAbTestingService } from "./services/builder-ab-testing.service";

// Feature Pack Controllers
import { AdvancedFormsController } from "./controllers/advanced-forms.controller";
import { BpmnController } from "./controllers/bpmn.controller";
import { ApiBuilderController } from "./controllers/api-builder.controller";
import { RulesEngineController } from "./controllers/rules-engine.controller";
import { EtlController } from "./controllers/etl.controller";
import { MobileBuilderController } from "./controllers/mobile-builder.controller";
import { ThemeManagerController } from "./controllers/theme-manager.controller";
import { AbTestingController } from "./controllers/ab-testing.controller";

import { BuilderDeepExpansionController } from "./controllers/builder-deep-expansion.controller";
import { BuilderDeepExpansionService } from "./services/builder-deep-expansion.service";
import { BuilderEnterpriseModule } from "./builder-enterprise.module";
import { DataObjectsController } from "./controllers/data-objects.controller";
import { BuilderDataObjectsService } from "./services/builder-data-objects.service";
import { CustomObjectSchemaService } from "./services/custom-object-schema.service";

@Module({
  imports: [DeveloperPlatformModule, AiClientModule, BuilderEnterpriseModule],
  controllers: [
    BuilderDeepExpansionController,
    BuilderController,
    WebPublicController,
    WebStudioController,
    GovernanceController,
    BuilderExpansionController,
    AdvancedFormsController,
    BpmnController,
    ApiBuilderController,
    RulesEngineController,
    EtlController,
    MobileBuilderController,
    ThemeManagerController,
    AbTestingController,
    DataObjectsController,
  ],
  providers: [
    BuilderDeepExpansionService,
    BuilderService,
    WebCollectionsService,
    WebStudioService,
    BuilderGovernanceService,
    BuilderScriptingService,
    BuilderAiService,
    BuilderFormsService,
    BuilderWorkflowsService,
    BuilderWorkflowRuntimeService,
    BuilderStatsService,
    BuilderDashboardsService,
    BuilderDevOpsService,
    BuilderWebContentService,
    BuilderExpansionService,
    BuilderAdvancedFormsService,
    BuilderBpmnService,
    BuilderApiService,
    BuilderRulesService,
    BuilderEtlService,
    BuilderMobileService,
    BuilderThemeService,
    BuilderAbTestingService,
    BuilderDataObjectsService,
    CustomObjectSchemaService,
  ],
  exports: [
    BuilderDeepExpansionService,
    BuilderService,
    WebCollectionsService,
    WebStudioService,
    BuilderGovernanceService,
    BuilderScriptingService,
  ],
})
export class BuilderModule {}
