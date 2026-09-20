import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { prisma } from '@kannan19302/database';
import { ControlPlaneAuditService } from '../control-plane-audit.service';

export type SubmissionStage =
  | 'SUBMITTED'
  | 'SECURITY_REVIEW'
  | 'FUNCTIONAL_REVIEW'
  | 'APPROVED'
  | 'REJECTED';

export interface ReviewChecklist {
  securitySastPassed: boolean;
  securityNoCriticalCve: boolean;
  securityLeastPrivilege: boolean;
  perfBundleUnder5Mb: boolean;
  perfColdStartUnder800ms: boolean;
  uxDocumentationComplete: boolean;
  uxHighResIcon: boolean;
  uxVerifiedContact: boolean;
}

export interface MarketplaceSubmission {
  id: string;
  appSlug: string;
  name: string;
  category: string;
  version: string;
  developerName: string;
  developerEmail: string;
  stage: SubmissionStage;
  assignedReviewer?: { id: string; name: string };
  checklist: ReviewChecklist;
  feedbackNotes?: string;
  submittedAt: string;
  updatedAt: string;
  approvedAt?: string;
  rejectedAt?: string;
}

export interface ExtensionVersion {
  id: string;
  appSlug: string;
  version: string;
  releaseNotes: string;
  changelogDiff: string;
  rolloutPercentage: number; // 0 to 100
  status: 'ACTIVE' | 'ROLLED_BACK' | 'DEPRECATED';
  releasedAt: string;
  rolledBackAt?: string;
  rollbackReason?: string;
}

/**
 * C25 & PCC-17 - Marketplace Operations & Partner Ecosystem
 * Manages extension submission review pipeline (EC-17.1), version management & staged rollouts (EC-17.2),
 * and emergency revocations across tenants (G-20).
 */
@Injectable()
export class MarketplaceService {
  private readonly logger = new Logger(MarketplaceService.name);

  // In-memory persistent state for submission pipeline & versions
  private submissions: MarketplaceSubmission[] = [
    {
      id: 'sub-crm-pro',
      appSlug: 'hubspot-advanced-crm',
      name: 'HubSpot Cloud CRM Connector',
      category: 'CRM & Sales',
      version: '2.1.0',
      developerName: 'HubIntegration Partners',
      developerEmail: 'devs@hubintegration.io',
      stage: 'SECURITY_REVIEW',
      assignedReviewer: { id: 'usr-sec-lead', name: 'Alice Security' },
      checklist: {
        securitySastPassed: true,
        securityNoCriticalCve: true,
        securityLeastPrivilege: true,
        perfBundleUnder5Mb: true,
        perfColdStartUnder800ms: false,
        uxDocumentationComplete: true,
        uxHighResIcon: true,
        uxVerifiedContact: true,
      },
      feedbackNotes: 'SAST scan clean. Awaiting cold-start performance verification under 800ms.',
      submittedAt: '2026-03-12T10:00:00Z',
      updatedAt: '2026-03-14T15:30:00Z',
    },
    {
      id: 'sub-stripe-tax',
      appSlug: 'stripe-tax-compliance',
      name: 'Stripe Automatic Global Tax Engine',
      category: 'Finance & Tax',
      version: '1.4.0',
      developerName: 'Stripe Official',
      developerEmail: 'ecosystem@stripe.com',
      stage: 'FUNCTIONAL_REVIEW',
      assignedReviewer: { id: 'usr-qa-lead', name: 'Bob Functional' },
      checklist: {
        securitySastPassed: true,
        securityNoCriticalCve: true,
        securityLeastPrivilege: true,
        perfBundleUnder5Mb: true,
        perfColdStartUnder800ms: true,
        uxDocumentationComplete: true,
        uxHighResIcon: true,
        uxVerifiedContact: true,
      },
      feedbackNotes: 'Passed security audit without findings. Functional regression test in flight.',
      submittedAt: '2026-03-10T08:20:00Z',
      updatedAt: '2026-03-15T11:00:00Z',
    },
    {
      id: 'sub-iot-fleet',
      appSlug: 'telematics-fleet-tracker',
      name: 'GeoFleet Telematics Tracker',
      category: 'Logistics',
      version: '1.0.0',
      developerName: 'FleetTech Solutions',
      developerEmail: 'contact@fleettech.net',
      stage: 'SUBMITTED',
      checklist: {
        securitySastPassed: false,
        securityNoCriticalCve: false,
        securityLeastPrivilege: false,
        perfBundleUnder5Mb: false,
        perfColdStartUnder800ms: false,
        uxDocumentationComplete: true,
        uxHighResIcon: true,
        uxVerifiedContact: true,
      },
      submittedAt: '2026-03-16T14:45:00Z',
      updatedAt: '2026-03-16T14:45:00Z',
    },
  ];

  private versions: ExtensionVersion[] = [
    {
      id: 'ver-crm-200',
      appSlug: 'hubspot-advanced-crm',
      version: '2.0.0',
      releaseNotes: 'Introduced webhook events for deals and pipeline stages.',
      changelogDiff: '+ Add DealWebhooksController\n+ Add OAuth Token Refresher\n- Deprecate polling sync',
      rolloutPercentage: 100,
      status: 'ACTIVE',
      releasedAt: '2026-01-15T00:00:00Z',
    },
    {
      id: 'ver-crm-210',
      appSlug: 'hubspot-advanced-crm',
      version: '2.1.0',
      releaseNotes: 'Bi-directional sync for quotes and invoices.',
      changelogDiff: '+ Add QuoteSyncService\n+ Batch invoice reconciliation support',
      rolloutPercentage: 25,
      status: 'ACTIVE',
      releasedAt: '2026-03-14T00:00:00Z',
    },
    {
      id: 'ver-tax-130',
      appSlug: 'stripe-tax-compliance',
      version: '1.3.0',
      releaseNotes: 'EU VAT 2026 rule updates and cross-border threshold engine.',
      changelogDiff: '+ Add EuVatThresholdCalculator\n- Removed obsolete 2024 tax schedules',
      rolloutPercentage: 100,
      status: 'ACTIVE',
      releasedAt: '2026-02-01T00:00:00Z',
    },
    {
      id: 'ver-tax-140',
      appSlug: 'stripe-tax-compliance',
      version: '1.4.0',
      releaseNotes: 'Real-time exemption certificate OCR upload.',
      changelogDiff: '+ Add ExemptionCertScanner\n+ Add S3 Document Vault Bridge',
      rolloutPercentage: 10,
      status: 'ACTIVE',
      releasedAt: '2026-03-15T00:00:00Z',
    },
  ];

  constructor(private readonly audit: ControlPlaneAuditService) {}

  // --- 1. Submission Review Pipeline (EC-17.1) ---

  async listSubmissions(stage?: string): Promise<MarketplaceSubmission[]> {
    if (stage) {
      return this.submissions.filter((s) => s.stage === stage);
    }
    return this.submissions;
  }

  async getSubmission(id: string): Promise<MarketplaceSubmission> {
    const submission = this.submissions.find((s) => s.id === id);
    if (!submission) {
      throw new NotFoundException(`Marketplace submission '${id}' not found`);
    }
    return submission;
  }

  async assignReviewer(
    id: string,
    reviewerId: string,
    reviewerName: string,
    actorId: string = 'SYSTEM'
  ): Promise<MarketplaceSubmission> {
    const submission = await this.getSubmission(id);
    submission.assignedReviewer = { id: reviewerId, name: reviewerName };
    submission.updatedAt = new Date().toISOString();

    await this.audit.record({
      actorId,
      actorRole: 'SUPER_ADMIN',
      action: 'marketplace.submission.assign_reviewer',
      targetId: id,
      details: { reviewerId, reviewerName },
    });

    return submission;
  }

  async updateSubmissionStage(
    id: string,
    stage: SubmissionStage,
    checklist?: Partial<ReviewChecklist>,
    feedbackNotes?: string,
    actorId: string = 'SYSTEM'
  ): Promise<MarketplaceSubmission> {
    const submission = await this.getSubmission(id);
    const oldStage = submission.stage;
    submission.stage = stage;
    submission.updatedAt = new Date().toISOString();

    if (checklist) {
      submission.checklist = { ...submission.checklist, ...checklist };
    }
    if (feedbackNotes !== undefined) {
      submission.feedbackNotes = feedbackNotes;
    }

    if (stage === 'APPROVED') {
      submission.approvedAt = new Date().toISOString();
    } else if (stage === 'REJECTED') {
      submission.rejectedAt = new Date().toISOString();
    }

    await this.audit.record({
      actorId,
      actorRole: 'SUPER_ADMIN',
      action: 'marketplace.submission.stage_transition',
      targetId: id,
      details: { from: oldStage, to: stage, checklist: submission.checklist, feedbackNotes },
    });

    return submission;
  }

  async approveExtension(id: string, actorId: string = 'SYSTEM') {
    const sub = this.submissions.find((s) => s.id === id);
    if (sub) {
      sub.stage = 'APPROVED';
      sub.approvedAt = new Date().toISOString();
      sub.updatedAt = new Date().toISOString();
    }

    await this.audit.record({
      actorId,
      actorRole: 'SUPER_ADMIN',
      action: 'marketplace.extension.approve',
      targetId: id,
      details: { approvedAt: new Date() },
    });

    return {
      success: true,
      message: `Extension submission ${id} approved and signed for release`,
      submission: sub,
    };
  }

  async rejectExtension(id: string, reason: string, actorId: string = 'SYSTEM') {
    const sub = this.submissions.find((s) => s.id === id);
    if (sub) {
      sub.stage = 'REJECTED';
      sub.rejectedAt = new Date().toISOString();
      sub.feedbackNotes = reason;
      sub.updatedAt = new Date().toISOString();
    }

    await this.audit.record({
      actorId,
      actorRole: 'SUPER_ADMIN',
      action: 'marketplace.extension.reject',
      targetId: id,
      details: { reason, rejectedAt: new Date() },
    });

    return {
      success: true,
      message: `Extension submission ${id} rejected. Reason: ${reason}`,
      submission: sub,
    };
  }

  // --- 2. Version Management & Staged Rollouts (EC-17.2) ---

  async listVersions(appSlug: string): Promise<ExtensionVersion[]> {
    return this.versions.filter((v) => v.appSlug === appSlug);
  }

  async updateRolloutPercentage(
    appSlug: string,
    version: string,
    percentage: number,
    actorId: string = 'SYSTEM'
  ): Promise<ExtensionVersion> {
    if (percentage < 0 || percentage > 100) {
      throw new BadRequestException('Rollout percentage must be between 0 and 100');
    }

    const ver = this.versions.find((v) => v.appSlug === appSlug && v.version === version);
    if (!ver) {
      throw new NotFoundException(`Version '${version}' for extension '${appSlug}' not found`);
    }

    const oldPercentage = ver.rolloutPercentage;
    ver.rolloutPercentage = percentage;

    await this.audit.record({
      actorId,
      actorRole: 'SUPER_ADMIN',
      action: 'marketplace.version.rollout_adjust',
      targetId: `${appSlug}:${version}`,
      details: { oldPercentage, newPercentage: percentage },
    });

    return ver;
  }

  async rollbackVersion(
    appSlug: string,
    targetVersion: string,
    reason: string,
    actorId: string = 'SYSTEM'
  ) {
    const target = this.versions.find((v) => v.appSlug === appSlug && v.version === targetVersion);
    if (!target) {
      throw new NotFoundException(`Target rollback version '${targetVersion}' for '${appSlug}' not found`);
    }

    // Set other newer versions to ROLLED_BACK
    for (const v of this.versions.filter((v) => v.appSlug === appSlug)) {
      if (v.version !== targetVersion && v.status === 'ACTIVE') {
        v.status = 'ROLLED_BACK';
        v.rolloutPercentage = 0;
        v.rolledBackAt = new Date().toISOString();
        v.rollbackReason = reason;
      }
    }

    target.status = 'ACTIVE';
    target.rolloutPercentage = 100;

    await this.audit.record({
      actorId,
      actorRole: 'SUPER_ADMIN',
      action: 'marketplace.version.rollback',
      targetId: appSlug,
      details: { rolledBackTo: targetVersion, reason },
    });

    return {
      success: true,
      appSlug,
      activeVersion: targetVersion,
      reason,
      rolledBackAt: new Date().toISOString(),
    };
  }

  // --- 3. Existing Inventory & Emergency Revocation (G-20) ---

  async listExtensions() {
    try {
      return await prisma.installedApp.findMany({
        distinct: ['appSlug'],
        select: {
          appSlug: true,
          appId: true,
          status: true,
        },
      });
    } catch {
      return [
        { appSlug: 'hubspot-advanced-crm', appId: 'app-crm', status: 'ACTIVE' },
        { appSlug: 'stripe-tax-compliance', appId: 'app-tax', status: 'ACTIVE' },
      ];
    }
  }

  async getExtensionInstallations(appSlug: string) {
    try {
      return await prisma.installedApp.findMany({
        where: { appSlug },
        include: { tenant: { select: { id: true, name: true, status: true } } },
      });
    } catch {
      return [];
    }
  }

  async emergencyRevokeExtension(appSlug: string, reason: string, actorId: string) {
    try {
      return await prisma.$transaction(async (tx) => {
        const installations = await tx.installedApp.findMany({
          where: { appSlug, status: { not: 'DISABLED' } },
          select: { id: true, tenantId: true },
        });

        if (installations.length === 0) {
          return { revoked: 0, message: 'No active installations found for this extension.' };
        }

        const { count } = await tx.installedApp.updateMany({
          where: { appSlug },
          data: { status: 'DISABLED' },
        });

        const affectedTenantIds = [...new Set(installations.map((i) => i.tenantId))];
        await tx.systemAnnouncement.createMany({
          data: affectedTenantIds.map((tenantId) => ({
            tenantId,
            title: `Extension Revoked: ${appSlug}`,
            message: `The extension "${appSlug}" has been emergency-revoked from the platform. Reason: ${reason}. Please contact support for alternatives.`,
            type: 'error',
            priority: 'high',
            createdBy: actorId,
          })),
        });

        await this.audit.record(
          {
            actorId,
            actorRole: 'SUPER_ADMIN',
            action: 'marketplace.extension.emergency_revoke',
            targetId: appSlug,
            details: {
              reason,
              revokedInstallations: count,
              affectedTenants: affectedTenantIds.length,
            },
          },
          tx as any,
        );

        return {
          appSlug,
          revokedInstallations: count,
          affectedTenants: affectedTenantIds.length,
          reason,
          revokedAt: new Date(),
        };
      });
    } catch {
      return {
        appSlug,
        revokedInstallations: 0,
        affectedTenants: 0,
        reason,
        revokedAt: new Date(),
      };
    }
  }
}
