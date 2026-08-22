import { Injectable, Logger } from "@nestjs/common";
import { prisma } from "@kannan19302/database";

/** Bridges developer workloads into the platform-wide immutable usage ledger.
 * An idempotency key is a workload identity (not a retry attempt), so worker
 * retries never overcharge or distort capacity reports. */
@Injectable()
export class DeveloperWorkloadMeteringService {
  private readonly db = prisma as any;
  private readonly logger = new Logger(DeveloperWorkloadMeteringService.name);

  async record(input: { tenantId: string; metric: "DEVELOPER_PREVIEW_SESSION" | "DEVELOPER_VALIDATION_BUILD"; workloadId: string; projectId: string }) {
    const idempotencyKey = `developer-workload/v1:${input.metric}:${input.workloadId}`;
    try {
      return await this.db.$transaction(async (tx: any) => {
        const existing = await tx.meteringEvent.findUnique({ where: { idempotencyKey } });
        if (existing) return existing;
        const event = await tx.meteringEvent.create({ data: { tenantId: input.tenantId, metric: input.metric, quantity: 1, idempotencyKey, source: `developer-platform:${input.projectId}` } });
        await tx.usageRecord.upsert({ where: { tenantId_metric: { tenantId: input.tenantId, metric: input.metric } }, create: { tenantId: input.tenantId, metric: input.metric, currentValue: 1, limitValue: 0 }, update: { currentValue: { increment: 1 } } });
        return event;
      });
    } catch (error) {
      // Metering outage must not roll back an already-safe preview/build. The
      // idempotency key enables an operational reconciler to replay it.
      this.logger.warn(`Could not record ${input.metric} workload ${input.workloadId}: ${(error as Error).message}`);
      return undefined;
    }
  }

  /** Tenant-scoped operational evidence for the governance console.  This is
   * intentionally a projection of the immutable ledger rather than a new
   * counter, so it cannot drift from billing/capacity reconciliation. */
  async usage(tenantId: string) {
    return this.db.usageRecord.findMany({
      where: { tenantId, metric: { in: ["DEVELOPER_PREVIEW_SESSION", "DEVELOPER_VALIDATION_BUILD"] } },
      select: { metric: true, currentValue: true, limitValue: true, updatedAt: true },
      orderBy: { metric: "asc" },
    });
  }
}
