import { describe, it, expect, beforeEach } from "vitest";
import { Test, TestingModule } from "@nestjs/testing";
import { ReportingBookmarksService } from "../services/reporting-bookmarks.service";
import { ReportingSharesService } from "../services/reporting-shares.service";
import { ReportingVersionsService } from "../services/reporting-versions.service";
import { ReportingExecutionLogsService } from "../services/reporting-execution-logs.service";
import { ReportingDataSourcesService } from "../services/reporting-data-sources.service";
import { ReportingCacheConfigService } from "../services/reporting-cache-config.service";
import { ReportingAlertRulesService } from "../services/reporting-alert-rules.service";
import { ReportingAuditLogsService } from "../services/reporting-audit-logs.service";
import { ReportingFilterPresetsService } from "../services/reporting-filter-presets.service";
import { ReportingColumnPreferencesService } from "../services/reporting-column-preferences.service";

describe("ReportingAdminDeepServices", () => {
  let bookmarksService: ReportingBookmarksService;
  let sharesService: ReportingSharesService;
  let versionsService: ReportingVersionsService;
  let execLogsService: ReportingExecutionLogsService;
  let dataSourcesService: ReportingDataSourcesService;
  let cacheConfigService: ReportingCacheConfigService;
  let alertRulesService: ReportingAlertRulesService;
  let auditLogsService: ReportingAuditLogsService;
  let filterPresetsService: ReportingFilterPresetsService;
  let colPrefsService: ReportingColumnPreferencesService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
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
    }).compile();
    bookmarksService = module.get(ReportingBookmarksService);
    sharesService = module.get(ReportingSharesService);
    versionsService = module.get(ReportingVersionsService);
    execLogsService = module.get(ReportingExecutionLogsService);
    dataSourcesService = module.get(ReportingDataSourcesService);
    cacheConfigService = module.get(ReportingCacheConfigService);
    alertRulesService = module.get(ReportingAlertRulesService);
    auditLogsService = module.get(ReportingAuditLogsService);
    filterPresetsService = module.get(ReportingFilterPresetsService);
    colPrefsService = module.get(ReportingColumnPreferencesService);
  });

  it("should be defined", () => {
    expect(bookmarksService).toBeDefined();
    expect(sharesService).toBeDefined();
    expect(versionsService).toBeDefined();
    expect(execLogsService).toBeDefined();
    expect(dataSourcesService).toBeDefined();
    expect(cacheConfigService).toBeDefined();
    expect(alertRulesService).toBeDefined();
    expect(auditLogsService).toBeDefined();
    expect(filterPresetsService).toBeDefined();
    expect(colPrefsService).toBeDefined();
  });
});
