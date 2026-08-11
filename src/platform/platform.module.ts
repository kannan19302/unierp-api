import { Module } from "@nestjs/common";
import { OperationsController } from "./v1/operations.controller";
import { OperationsService } from "./v1/operations.service";
import { SaasClusterRoutingDeepController } from "./v1/cluster-routing.controller";
import { SaasClusterRoutingDeepService } from "./v1/cluster-routing.service";
import { SaasEnterpriseScaleMasterController } from "./v1/enterprise-scale.controller";
import { SaasEnterpriseScaleMasterService } from "./v1/enterprise-scale.service";
import { SaasFeatureFlagsMeteringDeepController } from "./v1/feature-flags-metering.controller";
import { SaasFeatureFlagsMeteringDeepService } from "./v1/feature-flags-metering.service";
import { SaasResellerChannelDeepController } from "./v1/reseller-channel.controller";
import { SaasResellerChannelDeepService } from "./v1/reseller-channel.service";
import { SaasTenantMigrationDeepController } from "./v1/tenant-migration.controller";
import { SaasTenantMigrationDeepService } from "./v1/tenant-migration.service";
import { SaasWhiteLabelDeepController } from "./v1/white-label.controller";
import { SaasWhiteLabelDeepService } from "./v1/white-label.service";
import { SuperAdminController } from "./v1/super-admin.controller";
import { SuperAdminService } from "./v1/super-admin.service";
import { TenantLifecycleController } from "./v1/tenant-lifecycle.controller";
import { TenantLifecycleService } from "./v1/tenant-lifecycle.service";
import { ControlPlaneAuditService } from "./v1/control-plane-audit.service";
import { ControlPlaneApprovalsController } from "./v1/control-plane-approvals.controller";
import { ControlPlaneApprovalsService } from "./v1/control-plane-approvals.service";
import { ProviderRegistryService } from "./provider-registry/provider-registry.service";
import { PlansController } from "./v1/plans.controller";
import { PlansService } from "./v1/plans.service";
import { MeteringController } from "./v1/metering.controller";
import { MeteringService } from "./v1/metering.service";
import { SubscriptionManagementController } from "./v1/subscription-management.controller";
import { SubscriptionManagementService } from "./v1/subscription-management.service";
import { InvoicingController } from "./v1/invoicing.controller";
import { InvoicingService } from "./v1/invoicing.service";
import { DunningController } from "./v1/dunning.controller";
import { DunningService } from "./v1/dunning.service";
import { QuotaAdminController } from "./v1/quota-admin.controller";
import { QuotaAdminService } from "./v1/quota-admin.service";
import { SupportWorkspaceController } from "./v1/support-workspace.controller";
import { SupportWorkspaceService } from "./v1/support-workspace.service";
import { BroadcastMaintenanceController } from "./v1/broadcast-maintenance.controller";
import { BroadcastMaintenanceService } from "./v1/broadcast-maintenance.service";
import { CustomerImportController } from "./v1/customer-import.controller";
import { CustomerImportService } from "./v1/customer-import.service";
import { TenantExportOffboardingController } from "./v1/tenant-export-offboarding.controller";
import { TenantExportOffboardingService } from "./v1/tenant-export-offboarding.service";
import { ReleaseControlController } from "./v1/release-control.controller";
import { ReleaseControlService } from "./v1/release-control.service";
import { LiveTenantUpgradeController } from "./v1/live-tenant-upgrade.controller";
import { LiveTenantUpgradeService } from "./v1/live-tenant-upgrade.service";
import { SecurityOperationsController } from "./v1/security-operations.controller";
import { SecurityOperationsService } from "./v1/security-operations.service";
import { ConsoleGateway } from "./v1/console.gateway";

@Module({
  imports: [],
  controllers: [
    OperationsController,
    SaasClusterRoutingDeepController,
    SaasEnterpriseScaleMasterController,
    SaasFeatureFlagsMeteringDeepController,
    SaasResellerChannelDeepController,
    SaasTenantMigrationDeepController,
    SaasWhiteLabelDeepController,
    SuperAdminController,
    TenantLifecycleController,
    PlansController,
    MeteringController,
    SubscriptionManagementController,
    InvoicingController,
    DunningController,
    QuotaAdminController,
    SupportWorkspaceController,
    BroadcastMaintenanceController,
    CustomerImportController,
    TenantExportOffboardingController,
    ReleaseControlController,
    LiveTenantUpgradeController,
    SecurityOperationsController,
    ControlPlaneApprovalsController,
  ],
  providers: [
    ConsoleGateway,
    OperationsService,
    SaasClusterRoutingDeepService,
    SaasEnterpriseScaleMasterService,
    SaasFeatureFlagsMeteringDeepService,
    SaasResellerChannelDeepService,
    SaasTenantMigrationDeepService,
    SaasWhiteLabelDeepService,
    SuperAdminService,
    TenantLifecycleService,
    ControlPlaneAuditService,
    PlansService,
    MeteringService,
    SubscriptionManagementService,
    InvoicingService,
    DunningService,
    QuotaAdminService,
    SupportWorkspaceService,
    BroadcastMaintenanceService,
    CustomerImportService,
    TenantExportOffboardingService,
    ReleaseControlService,
    LiveTenantUpgradeService,
    SecurityOperationsService,
    ControlPlaneApprovalsService,
    ProviderRegistryService,
  ],
  exports: [ControlPlaneAuditService, ConsoleGateway, ProviderRegistryService],
})
export class PlatformModule {}
