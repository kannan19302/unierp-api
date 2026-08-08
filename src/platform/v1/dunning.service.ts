import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { prisma } from '@kannan19302/database';
import { ControlPlaneAuditService } from './control-plane-audit.service';

/**
 * C17 - Dunning & Collections
 * Implements a 4-step progressive dunning ladder:
 *   1. REMINDER → 2. WARNING → 3. FINAL_NOTICE → 4. SUSPEND
 * Recovery is triggered by successful payment.
 */

export type DunningStep = 'REMINDER' | 'WARNING' | 'FINAL_NOTICE' | 'SUSPEND';

const DUNNING_LADDER: DunningStep[] = ['REMINDER', 'WARNING', 'FINAL_NOTICE', 'SUSPEND'];

@Injectable()
export class DunningService {
  private readonly logger = new Logger(DunningService.name);

  constructor(private readonly audit: ControlPlaneAuditService) {}

  /**
   * Calculates the next dunning step for a tenant given the number of days past-due.
   * Pure function — safe to unit-test without DB.
   */
  getNextDunningStep(daysPastDue: number): DunningStep {
    if (daysPastDue < 7) return 'REMINDER';
    if (daysPastDue < 14) return 'WARNING';
    if (daysPastDue < 21) return 'FINAL_NOTICE';
    return 'SUSPEND';
  }

  async getDunningStatus(tenantId: string) {
    const sub = await prisma.tenantSubscription.findUnique({
      where: { tenantId },
      include: {
        invoices: {
          where: { status: { in: ['PENDING', 'OVERDUE'] } },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!sub) return { status: 'NO_SUBSCRIPTION', overdueInvoices: [] };

    const overdueInvoices = sub.invoices;
    const firstInvoice = overdueInvoices[0];
    const daysPastDue = firstInvoice ? Math.floor((Date.now() - firstInvoice.createdAt.getTime()) / 86400000) : 0;

    const currentStep = daysPastDue > 0 ? this.getNextDunningStep(daysPastDue) : null;

    return {
      tenantId,
      subscriptionStatus: sub.status,
      overdueInvoices: overdueInvoices.length,
      totalOverdueAmount: overdueInvoices.reduce((sum, inv) => sum + (inv.amountDue?.toNumber() || 0), 0),
      daysPastDue,
      currentDunningStep: currentStep,
    };
  }

  async executeDunningStep(tenantId: string, step: DunningStep, actorId: string) {
    return prisma.$transaction(async (tx) => {
      const sub = await tx.tenantSubscription.findUniqueOrThrow({ where: { tenantId } });

      let newStatus = sub.status;
      let action = `dunning.${step.toLowerCase()}`;

      if (step === 'SUSPEND') {
        newStatus = 'SUSPENDED';
        await tx.tenant.update({
          where: { id: tenantId },
          data: { status: 'SUSPENDED' },
        });
      }

      if (sub.status !== 'CANCELLED') {
        await tx.tenantSubscription.update({
          where: { tenantId },
          data: { status: newStatus },
        });
      }

      // Create announcement to tenant
      await tx.systemAnnouncement.create({
        data: {
          tenantId,
          title: `Payment Required - ${step.replace('_', ' ')}`,
          message: this.buildDunningMessage(step),
          type: step === 'SUSPEND' ? 'error' : 'warning',
          priority: step === 'FINAL_NOTICE' || step === 'SUSPEND' ? 'high' : 'normal',
          createdBy: actorId,
        },
      });

      await this.audit.record(
        {
          actorId,
          actorRole: 'SUPER_ADMIN',
          action,
          targetId: tenantId,
          details: { step, previousStatus: sub.status, newStatus },
        },
        tx as any,
      );

      return { tenantId, step, newStatus, message: `Dunning step ${step} executed.` };
    });
  }

  async recoverFromDunning(tenantId: string, actorId: string) {
    return prisma.$transaction(async (tx) => {
      await tx.tenantSubscription.update({
        where: { tenantId },
        data: { status: 'ACTIVE' },
      });

      await tx.tenant.update({
        where: { id: tenantId },
        data: { status: 'ACTIVE' },
      });

      await this.audit.record(
        {
          actorId,
          actorRole: 'SUPER_ADMIN',
          action: 'dunning.recover',
          targetId: tenantId,
          details: { recoveredAt: new Date() },
        },
        tx as any,
      );

      return { tenantId, status: 'ACTIVE', message: 'Subscription recovered from dunning.' };
    });
  }

  private buildDunningMessage(step: DunningStep): string {
    switch (step) {
      case 'REMINDER':
        return 'Your invoice is overdue. Please update your payment method to avoid service interruption.';
      case 'WARNING':
        return 'Your account has an unpaid balance. Service may be interrupted within 7 days if not resolved.';
      case 'FINAL_NOTICE':
        return 'Final notice: Your account will be suspended within 48 hours due to non-payment.';
      case 'SUSPEND':
        return 'Your account has been suspended due to non-payment. Please contact support to restore access.';
    }
  }
}
