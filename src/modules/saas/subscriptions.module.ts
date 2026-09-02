import { SubscriptionsGeneratedController } from "./controllers/subscriptions-generated.controller";
import { SubscriptionsGeneratedService } from "./services/subscriptions-generated.service";
import { Module } from "@nestjs/common";
import { SubscriptionsController } from "./controllers/subscriptions.controller";
import { SubscriptionsDeepController } from "./controllers/subscriptions-deep.controller";
import { SubscriptionsBulkController } from "./controllers/subscriptions-bulk.controller";
import { SubscriptionsService } from "./services/subscriptions.service";
import { SubscriptionPlansService } from "./services/subscription-plans.service";
import { SubscriptionUsageService } from "./services/subscription-usage.service";
import { SubscriptionCouponService } from "./services/subscription-coupon.service";
import { SubscriptionPlanGroupService } from "./services/subscription-plan-group.service";
import { SubscriptionMigrationService } from "./services/subscription-migration.service";
import { SubscriptionDunningService } from "./services/subscription-dunning.service";
import { SubscriptionCreditNoteService } from "./services/subscription-credit-note.service";
import { SubscriptionAutoScaleService } from "./services/subscription-auto-scale.service";

import { OrganizationEntitlementsController } from "./controllers/organization-entitlements.controller";
import { OrganizationEntitlementsService } from "./services/organization-entitlements.service";

import { SubscriptionsRepository } from "./repositories/subscriptions.repository";

@Module({
  controllers: [
    SubscriptionsGeneratedController,
    SubscriptionsController,
    SubscriptionsDeepController,
    SubscriptionsBulkController,
    OrganizationEntitlementsController,
  ],
  providers: [
    SubscriptionsRepository,
    SubscriptionsGeneratedService,
    SubscriptionsService,
    SubscriptionPlansService,
    SubscriptionUsageService,
    SubscriptionCouponService,
    SubscriptionPlanGroupService,
    SubscriptionMigrationService,
    SubscriptionDunningService,
    SubscriptionCreditNoteService,
    SubscriptionAutoScaleService,
    OrganizationEntitlementsService,
  ],
  exports: [
    SubscriptionsRepository,
    SubscriptionsGeneratedService,
    SubscriptionsService,
    SubscriptionPlansService,
    SubscriptionUsageService,
    SubscriptionCouponService,
    SubscriptionMigrationService,
    OrganizationEntitlementsService,
  ],
})
export class SubscriptionsModule {}
