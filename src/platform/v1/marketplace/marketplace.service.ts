import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { prisma } from '@kannan19302/database';
import { ControlPlaneAuditService } from '../control-plane-audit.service';

/**
 * C25 - Marketplace & Extension Admin
 * Manages extension listings, approvals, rejections, and emergency revocations.
 *
 * G-20: Emergency revocation updates ALL installed instances across ALL tenants
 *       in a single transaction with tenant notifications.
 */
@Injectable()
export class MarketplaceService {
  private readonly logger = new Logger(MarketplaceService.name);

  constructor(private readonly audit: ControlPlaneAuditService) {}

  async listExtensions() {
    return prisma.installedApp.findMany({
      distinct: ['appSlug'],
      select: {
        appSlug: true,
        appId: true,
        status: true,
      },
    });
  }

  async listSubmissions() {
    return [
      { id: 'ext-1', name: 'Advanced CRM', status: 'PENDING_REVIEW', submittedAt: new Date() },
      { id: 'ext-2', name: 'Payment Gateway', status: 'PENDING_REVIEW', submittedAt: new Date() },
    ];
  }

  async getExtensionInstallations(appSlug: string) {
    return prisma.installedApp.findMany({
      where: { appSlug },
      include: { tenant: { select: { id: true, name: true, status: true } } },
    });
  }

  async approveExtension(id: string, actorId: string) {
    await this.audit.record({
      actorId,
      actorRole: 'SUPER_ADMIN',
      action: 'marketplace.extension.approve',
      targetId: id,
      details: { approvedAt: new Date() },
    });
    return { success: true, message: `Extension ${id} approved and signed` };
  }

  async rejectExtension(id: string, reason: string, actorId: string) {
    await this.audit.record({
      actorId,
      actorRole: 'SUPER_ADMIN',
      action: 'marketplace.extension.reject',
      targetId: id,
      details: { reason, rejectedAt: new Date() },
    });
    return { success: true, message: `Extension ${id} rejected. Reason: ${reason}` };
  }

  /**
   * G-20: Emergency platform-wide revocation.
   * Disables ALL installations of the extension across ALL tenants in one transaction,
   * then notifies each affected tenant with a SystemAnnouncement.
   */
  async emergencyRevokeExtension(appSlug: string, reason: string, actorId: string) {
    return prisma.$transaction(async (tx) => {
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
  }
}
