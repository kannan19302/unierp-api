import { Module } from "@nestjs/common";
import { AdminController } from "./controllers/admin.controller";
import { AdminService } from "./services/admin.service";

import { ActivityFeedController } from "./controllers/activity-feed.controller";
import { ActivityFeedService } from "./services/activity-feed.service";
import { ImportExportController } from "./controllers/import-export.controller";
import { ImportExportService } from "./services/import-export.service";
import { AnnouncementsController } from "./controllers/announcements.controller";
import { AnnouncementsService } from "./services/announcements.service";

import { PlatformController } from "./controllers/platform.controller";
import { PlatformService } from "./services/platform.service";
import { CustomFieldsController } from "./controllers/custom-fields.controller";
import { CustomFieldsService } from "./services/custom-fields.service";
import { AutomationRulesController } from "./controllers/automation-rules.controller";
import { AutomationRulesService } from "./services/automation-rules.service";
import { AutomationRuleEngineService } from "./services/automation-rule-engine.service";
import { RecycleBinController } from "./controllers/recycle-bin.controller";
import { RecycleBinService } from "./services/recycle-bin.service";
import { AlertsController } from "./controllers/alerts.controller";
import { AlertsService } from "./services/alerts.service";
import { BulkOperationsController } from "./controllers/bulk-operations.controller";
import { BulkOperationsService } from "./services/bulk-operations.service";
import { DataQualityController } from "./controllers/data-quality.controller";
import { DataQualityService } from "./services/data-quality.service";
import { SubscriptionController } from "./controllers/subscription.controller";
import { SubscriptionService } from "./services/subscription.service";
import { ErrorReportsController } from "./controllers/error-reports.controller";
import { ErrorReportsService } from "./services/error-reports.service";
import { SupportImpersonationController } from "./controllers/support-impersonation.controller";
import { SupportImpersonationService } from "./services/support-impersonation.service";

import { PlatformCredentialsModule } from "../../common/platform-credentials/platform-credentials.module";
import { AccessReviewService } from "../../common/services/access-review.service";
import { AdminRepository } from "./repositories/admin.repository";

@Module({
  imports: [PlatformCredentialsModule],
  controllers: [
    AdminController,

    ActivityFeedController,
    ImportExportController,
    AnnouncementsController,

    PlatformController,
    CustomFieldsController,
    AutomationRulesController,
    RecycleBinController,
    AlertsController,
    BulkOperationsController,
    DataQualityController,
    SubscriptionController,
    ErrorReportsController,
    SupportImpersonationController,
  ],
  providers: [
    AdminRepository,
    AdminService,

    ActivityFeedService,
    ImportExportService,
    AnnouncementsService,

    PlatformService,
    CustomFieldsService,
    AutomationRulesService,
    AutomationRuleEngineService,
    RecycleBinService,
    AlertsService,
    BulkOperationsService,
    DataQualityService,
    SubscriptionService,
    ErrorReportsService,
    SupportImpersonationService,
    AccessReviewService,
  ],
  exports: [
    AdminRepository,
    AdminService,

    ActivityFeedService,
    ImportExportService,
    AnnouncementsService,

    PlatformService,
    CustomFieldsService,
    AutomationRulesService,
    RecycleBinService,
    AlertsService,
    BulkOperationsService,
    DataQualityService,
    SubscriptionService,
    ErrorReportsService,
  ],
})
export class AdminModule {}
