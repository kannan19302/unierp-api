import { ReportingGeneratedController } from "./controllers/reporting-generated.controller";
import { ReportingGeneratedService } from "./services/reporting-generated.service";
import { Module } from "@nestjs/common";
import { ReportingController } from "./controllers/reporting.controller";
import { ReportingService } from "./services/reporting.service";
import { ScheduledReportsController } from "./controllers/scheduled-reports.controller";
import { ScheduledReportsService } from "./services/scheduled-reports.service";
import { ReportingEngineService } from "./services/reporting-engine.service";
import { ReportingEngineController } from "./controllers/reporting-engine.controller";

import { ReportingTemplatesDeepService } from "./services/reporting-templates-deep.service";
import { ReportingTemplatesDeepController } from "./controllers/reporting-templates-deep.controller";
import { ReportingScheduledJobsDeepService } from "./services/reporting-scheduled-jobs-deep.service";
import { ReportingScheduledJobsDeepController } from "./controllers/reporting-scheduled-jobs-deep.controller";
import { ReportingExportsDeepService } from "./services/reporting-exports-deep.service";
import { ReportingExportsDeepController } from "./controllers/reporting-exports-deep.controller";
import { ReportingComplianceSignoffDeepService } from "./services/reporting-compliance-signoff-deep.service";
import { ReportingComplianceSignoffDeepController } from "./controllers/reporting-compliance-signoff-deep.controller";
import { ReportingDistributionListsDeepService } from "./services/reporting-distribution-lists-deep.service";
import { ReportingDistributionListsDeepController } from "./controllers/reporting-distribution-lists-deep.controller";
import { ReportingInteractiveViewerDeepService } from "./services/reporting-interactive-viewer-deep.service";
import { ReportingInteractiveViewerDeepController } from "./controllers/reporting-interactive-viewer-deep.controller";
import { ReportingDataDrilldownDeepService } from "./services/reporting-data-drilldown-deep.service";
import { ReportingDataDrilldownDeepController } from "./controllers/reporting-data-drilldown-deep.controller";
import { ReportingAdminDeepController } from "./controllers/reporting-admin-deep.controller";
import { ReportingBulkController } from "./controllers/reporting-bulk.controller";
import { ReportingBookmarksService } from "./services/reporting-bookmarks.service";
import { ReportingSharesService } from "./services/reporting-shares.service";
import { ReportingVersionsService } from "./services/reporting-versions.service";
import { ReportingExecutionLogsService } from "./services/reporting-execution-logs.service";
import { ReportingDataSourcesService } from "./services/reporting-data-sources.service";
import { ReportingCacheConfigService } from "./services/reporting-cache-config.service";
import { ReportingAlertRulesService } from "./services/reporting-alert-rules.service";
import { ReportingAuditLogsService } from "./services/reporting-audit-logs.service";
import { ReportingFilterPresetsService } from "./services/reporting-filter-presets.service";
import { ReportingColumnPreferencesService } from "./services/reporting-column-preferences.service";

import { ReportingRepository } from "./repositories/reporting.repository";

@Module({
  controllers: [
    ReportingGeneratedController,
    ReportingController,
    ScheduledReportsController,
    ReportingEngineController,
    ReportingTemplatesDeepController,
    ReportingScheduledJobsDeepController,
    ReportingExportsDeepController,
    ReportingComplianceSignoffDeepController,
    ReportingDistributionListsDeepController,
    ReportingInteractiveViewerDeepController,
    ReportingDataDrilldownDeepController,
    ReportingAdminDeepController,
    ReportingBulkController,
  ],
  providers: [
    ReportingRepository,
    ReportingGeneratedService,
    ReportingService,
    ScheduledReportsService,
    ReportingEngineService,
    ReportingTemplatesDeepService,
    ReportingScheduledJobsDeepService,
    ReportingExportsDeepService,
    ReportingComplianceSignoffDeepService,
    ReportingDistributionListsDeepService,
    ReportingInteractiveViewerDeepService,
    ReportingDataDrilldownDeepService,
    ReportingBookmarksService,
    ReportingSharesService,
    ReportingVersionsService,
    ReportingExecutionLogsService,
    ReportingDataSourcesService,
    ReportingCacheConfigService,
    ReportingAlertRulesService,
    ReportingAuditLogsService,
    ReportingFilterPresetsService,
    ReportingColumnPreferencesService,
  ],
  exports: [
    ReportingRepository,
    ReportingGeneratedService,
    ReportingService,
    ScheduledReportsService,
    ReportingEngineService,
    ReportingTemplatesDeepService,
    ReportingScheduledJobsDeepService,
    ReportingExportsDeepService,
    ReportingComplianceSignoffDeepService,
    ReportingDistributionListsDeepService,
    ReportingInteractiveViewerDeepService,
    ReportingDataDrilldownDeepService,
  ],
})
export class ReportingModule {}
