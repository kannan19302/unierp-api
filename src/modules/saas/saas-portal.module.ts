import { Module } from "@nestjs/common";
import { SaasPortalController } from "./controllers/saas-portal.controller";
import { SaasPortalService } from "./services/saas-portal.service";
import { SaasPortalOrgHierarchyController } from "./controllers/org-hierarchy.controller";
import { SaasPortalOrgHierarchyService } from "./services/org-hierarchy.service";
import { SaasPortalGdprComplianceController } from "./controllers/gdpr-compliance.controller";
import { SaasPortalGdprComplianceService } from "./services/gdpr-compliance.service";
import { GdprCryptoShredService } from "./services/gdpr-crypto-shred.service";
import { RecordLegalHoldService } from "./services/record-legal-hold.service";
import { SettingsChangeControlService } from "./services/settings-change-control.service";
import { TenantSecurityEnforcementService } from "./services/security-enforcement.service";
import { ScimProvisioningService } from "./services/scim-provisioning.service";
import { SaasPortalAuditLogController } from "./controllers/audit-log.controller";
import { SaasPortalAuditLogService } from "./services/saas-portal-audit-log.service";
import { SaasPortalSecurityController } from "./controllers/saas-portal-security.controller";
import { SaasPortalSecurityService } from "./services/security.service";
import { SaasPortalDelegationController } from "./controllers/delegation.controller";
import { SaasPortalDelegationService } from "./services/delegation.service";
import { SaasPortalBillingController } from "./controllers/saas-portal-billing.controller";
import { SaasPortalBillingService } from "./services/saas-portal-billing.service";
import { SaasPortalSubscriptionController } from "./controllers/subscription.controller";
import { SaasPortalSubscriptionService } from "./services/subscription.service";
import { SaasPortalBillingSelfServiceService } from "./services/saas-portal-billing-self-service.service";
import { SaasPortalBillingSelfServiceController } from "./controllers/saas-portal-billing-self-service.controller";
import { SaasPortalSubscriptionTierEngineService } from "./services/saas-portal-subscription-tier-engine.service";
import { SaasPortalSubscriptionTierEngineController } from "./controllers/saas-portal-subscription-tier-engine.controller";
import { SaasPortalUsageMetricsPortalService } from "./services/saas-portal-usage-metrics-portal.service";
import { SaasPortalUsageMetricsPortalController } from "./controllers/saas-portal-usage-metrics-portal.controller";
import { SaasPortalSupportSelfServiceService } from "./services/saas-portal-support-self-service.service";
import { SaasPortalSupportSelfServiceController } from "./controllers/saas-portal-support-self-service.controller";
import { SaasPortalFeedbackRoadmapService } from "./services/saas-portal-feedback-roadmap.service";
import { SaasPortalFeedbackRoadmapController } from "./controllers/saas-portal-feedback-roadmap.controller";
import { SaasPortalSsoSamlDeepService } from "./services/sso-saml.service";
import { SaasPortalSsoSamlDeepController } from "./controllers/sso-saml.controller";
import { SaasPortalAuditTrailDeepService } from "./services/audit-trail.service";
import { SaasPortalAuditTrailDeepController } from "./controllers/audit-trail.controller";
import { SaasPortalEnterpriseModule } from "./saas-portal-enterprise.module";
import { PrivacyOperationsService } from "./services/privacy-operations.service";
import { PrivacyOperationsProcessor } from "./services/privacy-operations.processor";
import { PrivacyOperationsScheduler } from "./services/privacy-operations.scheduler";
import { SaasPortalRepository } from "./repositories/saas-portal.repository";

@Module({
  imports: [SaasPortalEnterpriseModule],
  controllers: [
    SaasPortalController,
    SaasPortalOrgHierarchyController,
    SaasPortalGdprComplianceController,
    SaasPortalAuditLogController,
    SaasPortalSecurityController,
    SaasPortalDelegationController,
    SaasPortalBillingController,
    SaasPortalSubscriptionController,
    SaasPortalBillingSelfServiceController,
    SaasPortalSubscriptionTierEngineController,
    SaasPortalUsageMetricsPortalController,
    SaasPortalSupportSelfServiceController,
    SaasPortalFeedbackRoadmapController,
    SaasPortalSsoSamlDeepController,
    SaasPortalAuditTrailDeepController,
  ],
  providers: [
    SaasPortalRepository,
    SaasPortalService,
    SaasPortalOrgHierarchyService,
    SaasPortalGdprComplianceService,
    GdprCryptoShredService,
    RecordLegalHoldService,
    SettingsChangeControlService,
    TenantSecurityEnforcementService,
    ScimProvisioningService,
    SaasPortalAuditLogService,
    SaasPortalSecurityService,
    SaasPortalDelegationService,
    SaasPortalBillingService,
    SaasPortalSubscriptionService,
    SaasPortalBillingSelfServiceService,
    SaasPortalSubscriptionTierEngineService,
    SaasPortalUsageMetricsPortalService,
    SaasPortalSupportSelfServiceService,
    SaasPortalFeedbackRoadmapService,
    SaasPortalSsoSamlDeepService,
    SaasPortalAuditTrailDeepService,
    PrivacyOperationsService,
    PrivacyOperationsProcessor,
    PrivacyOperationsScheduler,
  ],
  exports: [
    SaasPortalRepository,
    SaasPortalService,
    SaasPortalOrgHierarchyService,
    SaasPortalGdprComplianceService,
    GdprCryptoShredService,
    RecordLegalHoldService,
    SettingsChangeControlService,
    TenantSecurityEnforcementService,
    ScimProvisioningService,
    SaasPortalAuditLogService,
    SaasPortalSecurityService,
    SaasPortalDelegationService,
    SaasPortalBillingService,
    SaasPortalSubscriptionService,
    SaasPortalBillingSelfServiceService,
    SaasPortalSubscriptionTierEngineService,
    SaasPortalUsageMetricsPortalService,
    SaasPortalSupportSelfServiceService,
    SaasPortalFeedbackRoadmapService,
    SaasPortalSsoSamlDeepService,
    SaasPortalAuditTrailDeepService,
    PrivacyOperationsService,
  ],
})
export class SaasPortalModule {}
