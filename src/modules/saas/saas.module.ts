import { Module } from "@nestjs/common";
import { SaasController } from "./controllers/saas.controller";
import { SaasService } from "./services/saas.service";
import { BillingService } from "./services/billing.service";
import { BillingController } from "./controllers/billing.controller";
import { BillingWebhookController } from "./controllers/billing-webhook.controller";
import { StorageMeteringService } from "./services/storage-metering.service";
import { PlanEngineService } from "./services/plan-engine.service";
import { PlanEngineController } from "./controllers/plan-engine.controller";
import { InvoiceEngineService } from "./services/invoice-engine.service";
import { InvoiceEngineController } from "./controllers/invoice-engine.controller";
import { PaymentMethodsService } from "./services/payment-methods.service";
import { PaymentMethodsController } from "./controllers/payment-methods.controller";
import { UsageAlertsService } from "./services/usage-alerts.service";
import { UsageAlertsController } from "./controllers/usage-alerts.controller";
import { ApiKeysService } from "./services/api-keys.service";
import { ApiKeysController } from "./controllers/api-keys.controller";
import { AuditLogService } from "./services/audit-log.service";
import { SupportTicketsService } from "./services/support-tickets.service";
import { SupportTicketsController } from "./controllers/support-tickets.controller";
import { DomainService } from "./services/domain-service";
import { DomainsController } from "./controllers/domains.controller";
import { SsoConfigService } from "./services/sso-config.service";
import { SsoConfigController } from "./controllers/sso-config.controller";
import { BrandingService } from "./services/branding.service";
import { BrandingController } from "./controllers/branding.controller";
import { DataExportService } from "./services/data-export.service";
import { DataExportController } from "./controllers/data-export.controller";
import { TenantFullExportService } from "./services/tenant-full-export.service";
import { WebhooksService } from "./services/webhooks.service";
import { WebhooksController } from "./controllers/webhooks.controller";
import { TenantAnalyticsService } from "./services/tenant-analytics.service";
import { TenantAdminController } from "./controllers/tenant-admin.controller";
import { AddonsController } from "./controllers/addons.controller";
import { AnnouncementsController } from "./controllers/announcements.controller";
import { SubscriptionLifecycleController } from "./controllers/subscription-lifecycle.controller";
import { BillingPortalController } from "./controllers/billing-portal.controller";
import { CustomerBillingController } from "./controllers/customer-billing.controller";
import { UsageAnalyticsController } from "./controllers/usage-analytics.controller";
import { MarketplaceController } from "./controllers/marketplace.controller";
import { ComplianceController } from "./controllers/compliance.controller";
import { SecurityController } from "./controllers/security.controller";
import { NotificationPrefsController } from "./controllers/notification-prefs.controller";
import { ReportsController } from "./controllers/reports.controller";
import { SupportAdminController } from "./controllers/support-admin.controller";
import { CouponsAdminController } from "./controllers/coupons-admin.controller";
import { AddonAdminController } from "./controllers/addon-admin.controller";
import { TenantProvisioningController } from "./controllers/tenant-provisioning.controller";
import { BillingAdminController } from "./controllers/billing-admin.controller";
import { MigrationController } from "./controllers/migration.controller";
import { SystemAdminController } from "./controllers/system-admin.controller";
import { InvoiceTemplatesController } from "./controllers/invoice-templates.controller";
import { FeatureFlagsController } from "./controllers/feature-flags.controller";
import { AnalyticsExtController } from "./controllers/analytics-ext.controller";
import { IntegrationsController } from "./controllers/integrations.controller";
import { OnboardingController } from "./controllers/onboarding.controller";
import { DemoDataService } from "./services/demo-data.service";
import { ContractsController } from "./controllers/contracts.controller";
import { PaymentsExtController } from "./controllers/payments-ext.controller";
import { ProfileController } from "./controllers/profile.controller";
import { ActivityFeedController } from "./controllers/activity-feed.controller";
import { HealthController } from "./controllers/health.controller";
import { SaasGateway } from "./controllers/saas.gateway";
import { RealtimeEmitterService } from "./services/realtime-emitter.service";
import { SaasExpansionController } from "./controllers/saas-expansion.controller";
import { SaasExpansionService } from "./services/saas-expansion.service";
import { SaasMeteringEngineDeepService } from "./services/metering-engine.service";
import { SaasMeteringEngineDeepController } from "./controllers/metering-engine.controller";

import { SaasQuotaGuardDeepService } from "./services/quota-guard.service";
import { SaasQuotaGuardDeepController } from "./controllers/quota-guard.controller";
import { SaasOnboardingFlowDeepService } from "./services/onboarding-flow.service";
import { SaasOnboardingFlowDeepController } from "./controllers/onboarding-flow.controller";

import { SaasRevenueChurnHealthDeepService } from "./services/revenue-churn-health.service";
import { SaasRevenueChurnHealthDeepController } from "./controllers/revenue-churn-health.controller";
import { SaasIntegrationsComplianceDeepService } from "./services/integrations-compliance.service";
import { SaasIntegrationsComplianceDeepController } from "./controllers/integrations-compliance.controller";
import { SaasMarketplaceLifecycleDeepService } from "./services/marketplace-lifecycle.service";
import { SaasMarketplaceLifecycleDeepController } from "./controllers/marketplace-lifecycle.controller";
import { OnboardingWizardController } from "./controllers/onboarding-wizard.controller";
import { OnboardingWizardService } from "./services/onboarding-wizard.service";
import { MasterDataImportService } from "./services/master-data-import.service";

import { PlatformCredentialsModule } from "../../common/platform-credentials/platform-credentials.module";
import { SaasRepository } from "./repositories/saas.repository";

@Module({
  imports: [PlatformCredentialsModule],
  controllers: [
    SaasController,
    BillingController,
    BillingWebhookController,
    PlanEngineController,
    InvoiceEngineController,
    PaymentMethodsController,
    UsageAlertsController,
    ApiKeysController,
    SupportTicketsController,
    DomainsController,
    SsoConfigController,
    BrandingController,
    DataExportController,
    WebhooksController,
    TenantAdminController,
    AddonsController,
    AnnouncementsController,
    SubscriptionLifecycleController,
    BillingPortalController,
    CustomerBillingController,
    UsageAnalyticsController,
    MarketplaceController,
    ComplianceController,
    SecurityController,
    NotificationPrefsController,
    ReportsController,
    SupportAdminController,
    CouponsAdminController,
    AddonAdminController,
    TenantProvisioningController,
    BillingAdminController,
    MigrationController,
    SystemAdminController,
    InvoiceTemplatesController,
    FeatureFlagsController,
    AnalyticsExtController,
    IntegrationsController,
    OnboardingController,
    ContractsController,
    PaymentsExtController,
    ProfileController,
    ActivityFeedController,
    HealthController,
    SaasExpansionController,
    SaasMeteringEngineDeepController,

    SaasQuotaGuardDeepController,
    SaasOnboardingFlowDeepController,

    SaasRevenueChurnHealthDeepController,
    SaasIntegrationsComplianceDeepController,
    SaasMarketplaceLifecycleDeepController,
    OnboardingWizardController,
  ],
  providers: [
    SaasRepository,
    SaasService,
    DemoDataService,
    SaasExpansionService,
    BillingService,
    StorageMeteringService,
    PlanEngineService,
    InvoiceEngineService,
    PaymentMethodsService,
    UsageAlertsService,
    ApiKeysService,
    AuditLogService,
    SupportTicketsService,
    DomainService,
    SsoConfigService,
    BrandingService,
    DataExportService,
    TenantFullExportService,
    WebhooksService,
    TenantAnalyticsService,
    SaasGateway,
    RealtimeEmitterService,
    SaasMeteringEngineDeepService,

    SaasQuotaGuardDeepService,
    SaasOnboardingFlowDeepService,

    SaasRevenueChurnHealthDeepService,
    SaasIntegrationsComplianceDeepService,
    SaasMarketplaceLifecycleDeepService,
    OnboardingWizardService,
    MasterDataImportService,
  ],
  exports: [
    SaasRepository,
    SaasService,
    SaasExpansionService,
    BillingService,
    StorageMeteringService,
    PlanEngineService,
    InvoiceEngineService,
    PaymentMethodsService,
    UsageAlertsService,
    ApiKeysService,
    AuditLogService,
    SupportTicketsService,
    DomainService,
    SsoConfigService,
    BrandingService,
    DataExportService,
    TenantFullExportService,
    WebhooksService,
    TenantAnalyticsService,
    SaasGateway,
    RealtimeEmitterService,
    SaasMeteringEngineDeepService,

    SaasQuotaGuardDeepService,
    SaasOnboardingFlowDeepService,

    SaasRevenueChurnHealthDeepService,
    SaasIntegrationsComplianceDeepService,
    SaasMarketplaceLifecycleDeepService,
    OnboardingWizardService,
    MasterDataImportService,
  ],
})
export class SaasModule {}
