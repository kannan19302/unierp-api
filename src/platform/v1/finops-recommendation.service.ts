/**
 * M31 — FinOps optimisation and waste recovery. Every recommendation
 * this file produces carries a `recommendedDesiredState` and executes
 * through the exact M09/M12 pipeline every other Track M mutation uses —
 * "no recommendation is advice-only" is the type signature of
 * `generateRecommendation()`, which cannot be called without a desired
 * state, not a policy someone has to remember.
 */
import { Injectable, BadRequestException, NotFoundException } from "@nestjs/common";
import { prisma } from "@kannan19302/database";
import { PlanningService } from "../operation-pipeline/planning.service";
import { DurableExecutorService } from "../operation-pipeline/durable-executor.service";
import { ResourceModelService } from "../resource-model/resource-model.service";
import { toCents, centsToDecimalString } from "./cost-allocation";

export type RecommendationKind = "IDLE" | "ORPHANED" | "OVER_PROVISIONED" | "UNATTRIBUTED";

@Injectable()
export class FinOpsRecommendationService {
  constructor(
    private readonly resources: ResourceModelService,
    private readonly planning: PlanningService,
    private readonly executor: DurableExecutorService,
  ) {}

  /**
   * `costBefore` is summed directly from M25's real ingested
   * CostLineItem rows for this resource — never typed in by hand — and
   * `predictedSaving` is a percentage of that real number, so the
   * exit criterion's "states its saving from M25's real prices" is true
   * of every recommendation this method can produce, not just the ones
   * a caller happens to compute correctly.
   */
  async generateRecommendation(
    resourceId: string,
    kind: RecommendationKind,
    savingFraction: number,
    recommendedDesiredState: Record<string, unknown>,
  ) {
    if (savingFraction <= 0 || savingFraction > 1) {
      throw new BadRequestException("savingFraction must be between 0 (exclusive) and 1 (inclusive)");
    }
    if (!recommendedDesiredState || Object.keys(recommendedDesiredState).length === 0) {
      throw new BadRequestException("a recommendation must carry a recommendedDesiredState — advice-only recommendations are refused");
    }

    const lineItems = await (prisma as any).costLineItem.findMany({ where: { resourceId } });
    const costBeforeCents = lineItems.reduce((sum: bigint, li: any) => sum + toCents(li.amount.toString()), 0n);
    const predictedSavingCents = BigInt(Math.round(Number(costBeforeCents) * savingFraction));

    return (prisma as any).finOpsRecommendation.create({
      data: {
        resourceId,
        kind,
        costBefore: centsToDecimalString(costBeforeCents),
        predictedSaving: centsToDecimalString(predictedSavingCents),
        recommendedDesiredState,
        status: "PENDING",
      },
    });
  }

  /**
   * Executes the recommendation AS A PLAN through M09/M12 — the same
   * pipeline discipline every other Track M mutation uses, never a
   * direct write to the target resource.
   */
  async executeRecommendation(id: string) {
    const rec = await (prisma as any).finOpsRecommendation.findUnique({ where: { id } });
    if (!rec) throw new NotFoundException(`Recommendation ${id} not found`);
    if (rec.status === "EXECUTED") {
      throw new BadRequestException(`Recommendation ${id} was already executed`);
    }

    const desiredState = rec.recommendedDesiredState as Record<string, unknown>;
    const plan = await this.planning.createPlan(rec.resourceId, desiredState);
    const job = await this.executor.startJob(
      `finops-execute-${id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      plan.id,
      rec.resourceId,
      [
        {
          name: "apply-recommendation",
          run: async () => {
            await this.resources.setDesiredState(rec.resourceId, desiredState);
            return { applied: desiredState };
          },
        },
      ],
    );

    await (prisma as any).finOpsRecommendation.update({
      where: { id },
      data: { status: "EXECUTED", executedAt: new Date() },
    });

    return { jobStatus: job.status };
  }

  /**
   * "A recommendation acted upon is measured afterwards against its
   * predicted saving, and the difference is shown" — `actualCostAfter`
   * is the real cost observed once the change has had time to take
   * effect (a later M25 ingestion), never assumed to equal the
   * prediction.
   */
  async measureActualSaving(id: string, actualCostAfter: string) {
    const rec = await (prisma as any).finOpsRecommendation.findUnique({ where: { id } });
    if (!rec) throw new NotFoundException(`Recommendation ${id} not found`);
    if (rec.status !== "EXECUTED") {
      throw new BadRequestException(`Recommendation ${id} has not been executed yet — nothing to measure`);
    }

    const costBeforeCents = toCents(rec.costBefore.toString());
    const actualCostAfterCents = toCents(actualCostAfter);
    const actualSavingCents = costBeforeCents - actualCostAfterCents;
    const predictedSavingCents = toCents(rec.predictedSaving.toString());
    const varianceCents = actualSavingCents - predictedSavingCents;

    return (prisma as any).finOpsRecommendation.update({
      where: { id },
      data: {
        actualCostAfter,
        actualSaving: centsToDecimalString(actualSavingCents),
        variance: centsToDecimalString(varianceCents),
      },
    });
  }
}
