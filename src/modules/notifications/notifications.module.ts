import { NotificationsGeneratedController } from "./controllers/notifications-generated.controller";
import { NotificationsGeneratedService } from "./services/notifications-generated.service";
import { Module } from "@nestjs/common";
import { NotificationsController } from "./controllers/notifications.controller";
import { NotificationPreferencesController } from "./controllers/notification-preferences.controller";
import { NotificationsDeepController } from "./controllers/notifications-deep.controller";
import { DeviceTokensController } from "./controllers/device-tokens.controller";
import { NotificationsService } from "./services/notifications.service";
import { NotificationsDeepService } from "./services/notifications-deep.service";
import { NotificationDeliveryService } from "./services/notification-delivery.service";
import { DeviceTokensService } from "./services/device-tokens.service";
import { NotificationsGateway } from "./controllers/notifications.gateway";
import { InvoiceOverdueNotificationService } from "./services/invoice-overdue-notification.service";
import { PipelineRiskNotificationService } from "./services/pipeline-risk-notification.service";
import { PlatformModule } from "../../platform/platform.module";
import { NotificationsRepository } from "./repositories/notifications.repository";

@Module({
  imports: [PlatformModule],
  controllers: [
    NotificationsGeneratedController,
    NotificationsController,
    NotificationPreferencesController,
    NotificationsDeepController,
    DeviceTokensController,
  ],
  providers: [
    NotificationsRepository,
    NotificationsGeneratedService,
    NotificationsService,
    NotificationsDeepService,
    NotificationDeliveryService,
    DeviceTokensService,
    NotificationsGateway,
    InvoiceOverdueNotificationService,
    PipelineRiskNotificationService,
  ],
  exports: [
    NotificationsRepository,
    NotificationsGeneratedService,
    NotificationsService,
    NotificationsDeepService,
    NotificationDeliveryService,
    DeviceTokensService,
    NotificationsGateway,
  ],
})
export class NotificationsModule {}
