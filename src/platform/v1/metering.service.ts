import { Injectable, Logger, ConflictException } from '@nestjs/common';
import { prisma } from '@kannan19302/database';
import { ControlPlaneAuditService } from './control-plane-audit.service';

export interface RecordEventDto {
  metric: string;
  quantity: number;
  idempotencyKey: string;
  source: string;
}

@Injectable()
export class MeteringService {
  private readonly logger = new Logger(MeteringService.name);

  constructor(private readonly audit: ControlPlaneAuditService) {}

  async getUsage(tenantId: string) {
    return prisma.usageRecord.findMany({
      where: { tenantId },
      orderBy: { metric: 'asc' },
    });
  }

  async getEvents(tenantId: string, metric: string) {
    return (prisma as any).meteringEvent.findMany({
      where: { tenantId, metric },
      orderBy: { timestamp: 'desc' },
      take: 1000,
    });
  }

  async recordEvent(tenantId: string, dto: RecordEventDto, actorId: string) {
    return prisma.$transaction(async (tx) => {
      // 1. Check idempotency (G-2)
      const existing = await (tx as any).meteringEvent.findUnique({
        where: { idempotencyKey: dto.idempotencyKey },
      });

      if (existing) {
        this.logger.warn(`Idempotency key collision for ${dto.idempotencyKey}`);
        throw new ConflictException('Event already recorded');
      }

      // 2. Insert event
      const event = await (tx as any).meteringEvent.create({
        data: {
          tenantId,
          metric: dto.metric,
          quantity: dto.quantity,
          idempotencyKey: dto.idempotencyKey,
          source: dto.source,
        },
      });

      // 3. Upsert usage snapshot
      await tx.usageRecord.upsert({
        where: {
          tenantId_metric: { tenantId, metric: dto.metric },
        },
        update: {
          currentValue: { increment: dto.quantity },
        },
        create: {
          tenantId,
          metric: dto.metric,
          currentValue: dto.quantity,
          limitValue: 0, // Should be populated by feature-flags, but default to 0
        },
      });

      return event;
    });
  }

  async reconcile(tenantId: string, metric: string, actorId: string) {
    return prisma.$transaction(async (tx) => {
      // 1. Recalculate true sum from events
      const agg = await (tx as any).meteringEvent.aggregate({
        where: { tenantId, metric },
        _sum: { quantity: true },
      });
      const trueSum = agg._sum.quantity || 0;

      // 2. Fetch current record
      const usage = await tx.usageRecord.findUnique({
        where: { tenantId_metric: { tenantId, metric } },
      });

      // 3. Adjust if different
      if (usage && usage.currentValue !== trueSum) {
        this.logger.warn(`Reconciliation drift detected for ${tenantId}/${metric}: Snapshot=${usage.currentValue}, True=${trueSum}`);
        await tx.usageRecord.update({
          where: { tenantId_metric: { tenantId, metric } },
          data: { currentValue: trueSum },
        });

        await this.audit.record(
          {
            actorId,
            actorRole: 'SUPER_ADMIN',
            action: 'metering.reconcile',
            targetId: tenantId,
            details: { metric, before: usage.currentValue, after: trueSum },
          },
          tx as any,
        );
      }

      return { trueSum, drifted: usage ? usage.currentValue !== trueSum : false };
    });
  }
}
