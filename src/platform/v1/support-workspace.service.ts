import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { prisma } from '@kannan19302/database';
import { ControlPlaneAuditService } from './control-plane-audit.service';

/**
 * C20 - Support Workspace
 * Provides tenant health score, error log retrieval, session replay pointers,
 * and L1 ticket resolution capability for Super Admins.
 *
 * G-19: L1 ticket resolution must be idempotent (resolve a ticket without side-effects if already resolved).
 */
@Injectable()
export class SupportWorkspaceService {
  private readonly logger = new Logger(SupportWorkspaceService.name);

  constructor(private readonly audit: ControlPlaneAuditService) {}

  /**
   * Compute tenant health score (0–100) from recent subscription, error log, and usage data.
   */
  async getTenantHealth(tenantId: string) {
    const [tenant, sub, openTickets, usageRecords] = await Promise.all([
      prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } }),
      prisma.tenantSubscription.findUnique({ where: { tenantId } }),
      prisma.tenantSupportTicket.count({ where: { tenantId, status: { in: ['OPEN', 'IN_PROGRESS'] } } }),
      prisma.usageRecord.findMany({ where: { tenantId } }),
    ]);

    // Score based on: subscription status (40pts), open tickets (30pts), usage (30pts)
    let score = 100;

    if (!sub || sub.status !== 'ACTIVE') score -= 40;
    score -= Math.min(30, openTickets * 10);

    const exceeded = usageRecords.filter((u) => u.currentValue > u.limitValue).length;
    score -= Math.min(30, exceeded * 15);

    return {
      tenantId,
      name: tenant.name,
      status: tenant.status,
      subscriptionStatus: sub?.status ?? 'NONE',
      healthScore: Math.max(0, score),
      openTickets,
      exceededQuotas: exceeded,
      computedAt: new Date(),
    };
  }

  async listTickets(tenantId: string, status?: string) {
    return prisma.tenantSupportTicket.findMany({
      where: { tenantId, ...(status ? { status } : {}) },
      include: { messages: { orderBy: { createdAt: 'desc' }, take: 1 } },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * G-19: Idempotent L1 resolution. If ticket is already resolved, returns current state.
   */
  async resolveTicket(ticketId: string, resolution: string, actorId: string) {
    const ticket = await prisma.tenantSupportTicket.findUniqueOrThrow({ where: { id: ticketId } });

    // Idempotency: already resolved → return as-is
    if (ticket.status === 'RESOLVED' || ticket.status === 'CLOSED') {
      return { ...ticket, alreadyResolved: true };
    }

    return prisma.$transaction(async (tx) => {
      const resolved = await tx.tenantSupportTicket.update({
        where: { id: ticketId },
        data: {
          status: 'RESOLVED',
          resolvedAt: new Date(),
        },
      });

      await tx.ticketMessage.create({
        data: {
          ticketId,
          userId: actorId,
          message: `[L1 Resolution] ${resolution}`,
          isStaff: true,
        },
      });

      await this.audit.record(
        {
          actorId,
          actorRole: 'SUPER_ADMIN',
          action: 'support.ticket.resolve',
          targetId: ticketId,
          details: { resolution, tenantId: ticket.tenantId },
        },
        tx as any,
      );

      return resolved;
    });
  }

  async getSessionReplayPointers(tenantId: string) {
    // Returns pointers to session replay data (stored in tenant settings or external APM)
    const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    const settings = tenant.settings as any;

    return {
      tenantId,
      replayProvider: settings?.apm?.provider ?? 'POSTHOG',
      replayUrl: settings?.apm?.replayUrl ?? `https://posthog.example.com/replay?tenant=${tenantId}`,
      sessionCount: settings?.apm?.sessionCount ?? 0,
      lastRecordedAt: settings?.apm?.lastRecordedAt ?? null,
    };
  }
}
