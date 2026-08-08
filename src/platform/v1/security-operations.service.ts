import { Injectable, Logger } from '@nestjs/common';
import { prisma } from '@kannan19302/database';
import { ControlPlaneAuditService } from './control-plane-audit.service';

/**
 * C28 - Security Operations Centre (SOC)
 * Provides platform-wide session revocation, tenant quarantine,
 * and end-to-end breach response execution.
 */
@Injectable()
export class SecurityOperationsService {
  private readonly logger = new Logger(SecurityOperationsService.name);

  constructor(private readonly audit: ControlPlaneAuditService) {}

  async revokeTenantSessions(tenantId: string, reason: string, actorId: string) {
    return prisma.$transaction(async (tx) => {
      // Invalidate all login histories for tenant
      const revoked = await tx.loginHistory.updateMany({
        where: { tenantId },
        data: { status: 'REVOKED' },
      });

      await this.audit.record(
        {
          actorId,
          actorRole: 'SUPER_ADMIN',
          action: 'soc.session.revoke_tenant',
          targetId: tenantId,
          details: { reason, count: revoked.count },
        },
        tx as any,
      );

      return { tenantId, revokedCount: revoked.count, reason, revokedAt: new Date() };
    });
  }

  async quarantineTenant(tenantId: string, reason: string, actorId: string) {
    return prisma.$transaction(async (tx) => {
      const updated = await tx.tenant.update({
        where: { id: tenantId },
        data: { status: 'SUSPENDED' },
      });

      await tx.systemAnnouncement.create({
        data: {
          tenantId,
          title: 'Security Quarantine Alert',
          message: `Your account has been quarantined by SOC. Reason: ${reason}. Please contact security@platform.internal immediately.`,
          type: 'error',
          priority: 'high',
          createdBy: actorId,
        },
      });

      await this.audit.record(
        {
          actorId,
          actorRole: 'SUPER_ADMIN',
          action: 'soc.tenant.quarantine',
          targetId: tenantId,
          details: { reason },
        },
        tx as any,
      );

      return { tenantId, status: 'SUSPENDED', reason, quarantinedAt: new Date() };
    });
  }

  async executeBreachResponse(dto: { scope: 'TENANT' | 'GLOBAL'; tenantId?: string; breachDetails: string }, actorId: string) {
    return prisma.$transaction(async (tx) => {
      if (dto.scope === 'TENANT' && dto.tenantId) {
        await tx.loginHistory.updateMany({
          where: { tenantId: dto.tenantId },
          data: { status: 'REVOKED' },
        });
        await tx.tenant.update({
          where: { id: dto.tenantId },
          data: { status: 'SUSPENDED' },
        });
      } else {
        // Global breach response
        await tx.loginHistory.updateMany({
          data: { status: 'REVOKED' },
        });
      }

      await this.audit.record(
        {
          actorId,
          actorRole: 'SUPER_ADMIN',
          action: 'soc.breach_response.execute',
          targetId: dto.tenantId || 'GLOBAL',
          details: dto,
        },
        tx as any,
      );

      return {
        scope: dto.scope,
        tenantId: dto.tenantId,
        breachResponseExecuted: true,
        executedAt: new Date(),
      };
    });
  }
}
