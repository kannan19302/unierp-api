import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import { prisma } from "@kannan19302/database";
import { idpClient as idpPrisma } from "@/common/idp-client";

@Injectable()
export class SaasMeteringEngineDeepService {
  async getMeteringRules(tenantId: string) {
    return prisma.saasMeteringRule.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
    });
  }

  async createMeteringRule(tenantId: string, dto: any) {
    return prisma.saasMeteringRule.create({
      data: {
        tenantId,
        metricCode: dto.metricCode,
        unitPrice: dto.unitPrice,
        currency: dto.currency || "USD",
        aggregationType: dto.aggregationType || "SUM",
        freeTierAllowance: dto.freeTierAllowance || 0,
      },
    });
  }

  /**
   * K05 exit criterion: "Metering is idempotent under replay: the same
   * event delivered twice is counted once, proven by test."
   *
   * batchRef is @unique in the schema, but the previous version generated
   * a fresh `BATCH-${Date.now()}` whenever the caller omitted it, and
   * simply called .create() when they did supply one — a retried delivery
   * of the SAME batchRef hit the DB's unique constraint and threw an
   * unhandled P2002, rather than being recognized as a replay and
   * returned as a no-op. A caller without idempotency-key retry handling
   * (e.g. a naive HTTP client after a timeout) could not tell "duplicate,
   * already counted" apart from "genuine server error" — and depending on
   * transaction ordering, a redelivered batch could be reprocessed under
   * a NEW auto-generated batchRef if the caller regenerated the ref on
   * retry, double-counting the same usage events toward billing.
   */
  async processUsageBatch(
    tenantId: string,
    dto: { batchRef: string; events: any[] },
  ) {
    if (!dto.batchRef) {
      throw new BadRequestException(
        "batchRef is required — usage cannot be metered idempotently without a caller-supplied, stable replay key.",
      );
    }

    const existing = await prisma.saasUsageEventBatch.findFirst({
      where: { tenantId, batchRef: dto.batchRef },
    });
    if (existing) {
      // Same batchRef delivered again — this is a replay, not a new
      // batch. Return the already-processed record unchanged rather
      // than reprocessing (double-counting) or throwing.
      return existing;
    }

    return prisma.saasUsageEventBatch.create({
      data: {
        tenantId,
        batchRef: dto.batchRef,
        eventCount: dto.events.length,
        processedCount: dto.events.length,
        status: "COMPLETED",
        payload: dto.events,
        processedAt: new Date(),
      },
    });
  }

  async getBatchHistory(tenantId: string) {
    return prisma.saasUsageEventBatch.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
  }
}
