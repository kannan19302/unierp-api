import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { prisma } from '@kannan19302/database';
import { ControlPlaneAuditService } from './control-plane-audit.service';
import * as crypto from 'crypto';

/**
 * C24 - Tenant Export & Offboarding
 * Produces re-importable exports and cryptographically signed Deletion Certificates.
 * Consistent with DELETION_POLICY.md.
 */
@Injectable()
export class TenantExportOffboardingService {
  private readonly logger = new Logger(TenantExportOffboardingService.name);

  constructor(private readonly audit: ControlPlaneAuditService) {}

  async listExportJobs(tenantId: string) {
    return prisma.dataExportJob.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Initiates a full-tenant export job. The export format is re-importable
   * (JSON with schema version, suitable for C23 CustomerImportService).
   */
  async startExport(dto: {
    tenantId: string;
    format: 'JSON' | 'CSV' | 'XLSX';
    modules?: string[];
  }, actorId: string) {
    const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: dto.tenantId } });

    const job = await prisma.$transaction(async (tx) => {
      const exportJob = await tx.dataExportJob.create({
        data: {
          tenantId: dto.tenantId,
          type: 'EXPORT',
          format: dto.format,
          scope: { modules: dto.modules ?? ['all'], requestedBy: actorId },
          status: 'PENDING',
        },
      });

      await this.audit.record(
        {
          actorId,
          actorRole: 'SUPER_ADMIN',
          action: 'export.start',
          targetId: dto.tenantId,
          details: { jobId: exportJob.id, format: dto.format, modules: dto.modules },
        },
        tx as any,
      );

      return exportJob;
    });

    return { jobId: job.id, status: 'PENDING', format: dto.format, tenantName: tenant.name };
  }

  /**
   * K15 exit criterion (G-4): "A tenant exits fully unaided and receives
   * a deletion certificate. Verified by rehearsal, not by clause."
   *
   * This method previously issued a cryptographically signed artefact
   * TYPED "DELETION_CERTIFICATE" with a `deletedAt` timestamp — but
   * never deleted any tenant data anywhere. It set `tenant.status =
   * 'OFFBOARDED'`, cancelled subscriptions, and queued a (never-
   * automatically-processed) export job — a signed, tamper-evident-
   * looking legal artefact asserting a fact (deletion occurred) that
   * was simply false. Confirmed by grep: no cron/worker/cascading-
   * delete job anywhere in this codebase reacts to the OFFBOARDED
   * status; nothing was ever actually deleted after this ran.
   *
   * A full cascading purge across this platform's ~1000+ tenant-scoped
   * tables is out of scope for a single pass — the honest fix here is
   * to stop the certificate from claiming something unverified. Issues
   * an OFFBOARDING_RECEIPT instead: accurately describes what WAS done
   * (status change, subscription cancellation, export queued) and
   * explicitly states `dataDeleted: false` with the real reason, so no
   * signed artefact makes a claim this platform cannot back up "by
   * rehearsal."
   */
  async offboardTenant(tenantId: string, reason: string, actorId: string) {
    if (!reason || reason.length < 10) {
      throw new BadRequestException('A detailed reason (>10 chars) is required for tenant offboarding');
    }

    const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });

    return prisma.$transaction(async (tx) => {
      // First, export the tenant data (create export record)
      const exportJob = await tx.dataExportJob.create({
        data: {
          tenantId,
          type: 'EXPORT',
          format: 'JSON',
          scope: { modules: ['all'], preOffboarding: true },
          status: 'PROCESSING',
        },
      });

      // Mark tenant as offboarded
      await tx.tenant.update({
        where: { id: tenantId },
        data: { status: 'OFFBOARDED' },
      });

      // Cancel subscriptions
      await tx.tenantSubscription.updateMany({
        where: { tenantId, status: { not: 'CANCELLED' } },
        data: { status: 'CANCELLED', cancelledAt: new Date() },
      });

      // Sign an OFFBOARDING RECEIPT — not a deletion certificate. This
      // asserts only what actually happened in this transaction: the
      // tenant status changed, subscriptions were cancelled, and an
      // export was queued. It does NOT claim data was deleted, because
      // it was not.
      const receiptPayload = JSON.stringify({
        tenantId,
        tenantName: tenant.name,
        tenantSlug: tenant.slug,
        reason,
        offboardedBy: actorId,
        offboardedAt: new Date().toISOString(),
        exportJobId: exportJob.id,
        dataDeleted: false,
        version: '1.0',
      });

      const signature = crypto
        .createHmac('sha256', process.env.DELETION_CERT_SECRET ?? 'platform-deletion-key')
        .update(receiptPayload)
        .digest('hex');

      const receipt = {
        type: 'OFFBOARDING_RECEIPT',
        version: '1.0',
        tenantId,
        tenantName: tenant.name,
        reason,
        offboardedBy: actorId,
        offboardedAt: new Date().toISOString(),
        exportJobId: exportJob.id,
        dataDeleted: false,
        dataRetentionNote:
          'Tenant data has not been deleted. This receipt confirms the tenant was marked ' +
          'OFFBOARDED and its subscriptions cancelled, and that a full export was queued. ' +
          'A deletion certificate is issued only once tenant data deletion has actually ' +
          'occurred and been verified.',
        signature,
      };

      await this.audit.record(
        {
          actorId,
          actorRole: 'SUPER_ADMIN',
          action: 'tenant.offboard',
          targetId: tenantId,
          details: { reason, receipt: { signature, exportJobId: exportJob.id, dataDeleted: false } },
        },
        tx as any,
      );

      return {
        tenantId,
        status: 'OFFBOARDED',
        exportJobId: exportJob.id,
        offboardingReceipt: receipt,
      };
    });
  }
}
