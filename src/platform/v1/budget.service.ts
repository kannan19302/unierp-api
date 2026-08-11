/**
 * M29 (budget half) — a budget crossing its threshold alerts, and, where
 * an enforcement is configured, executes it as an M09 plan run through
 * M12's durable executor — never a direct mutation. "Alert only" (no
 * enforcementResourceId) is a deliberately valid, common configuration,
 * not a fallback for an unfinished feature.
 */
import { Injectable, BadRequestException } from "@nestjs/common";
import { prisma } from "@kannan19302/database";
import { PlanningService } from "../operation-pipeline/planning.service";
import { DurableExecutorService } from "../operation-pipeline/durable-executor.service";
import { ResourceModelService } from "../resource-model/resource-model.service";
import { ControlPlaneAuditService } from "./control-plane-audit.service";
import { toCents } from "./cost-allocation";

export interface BudgetCheckResult {
  crossed: boolean;
  actualSpend: string;
  thresholdAmount: string;
  enforced: boolean;
  jobStatus: string | null;
}

@Injectable()
export class BudgetService {
  constructor(
    private readonly planning: PlanningService,
    private readonly executor: DurableExecutorService,
    private readonly resources: ResourceModelService,
    private readonly audit: ControlPlaneAuditService,
  ) {}

  async createBudget(
    tenantId: string,
    period: string,
    thresholdAmount: string,
    enforcement?: { resourceId: string; desiredState: Record<string, unknown> },
  ) {
    if (!thresholdAmount) throw new BadRequestException("thresholdAmount is required");
    return (prisma as any).budgetPolicy.upsert({
      where: { tenantId_period: { tenantId, period } },
      create: {
        tenantId,
        period,
        thresholdAmount,
        enforcementResourceId: enforcement?.resourceId ?? null,
        enforcementDesiredState: enforcement?.desiredState ?? null,
      },
      update: {
        thresholdAmount,
        enforcementResourceId: enforcement?.resourceId ?? null,
        enforcementDesiredState: enforcement?.desiredState ?? null,
      },
    });
  }

  /**
   * `actualSpend` is supplied by the caller (M28's MarginService or
   * M27's CostAllocationService already compute a tenant's real cost) —
   * this method is deliberately not a second cost-aggregation
   * implementation.
   */
  async checkAndEnforce(tenantId: string, period: string, actualSpend: string): Promise<BudgetCheckResult> {
    const budget = await (prisma as any).budgetPolicy.findUnique({
      where: { tenantId_period: { tenantId, period } },
    });
    if (!budget) {
      throw new BadRequestException(`No budget policy for tenant "${tenantId}" period "${period}"`);
    }

    const crossed = toCents(actualSpend) >= toCents(budget.thresholdAmount.toString());
    if (!crossed) {
      return { crossed: false, actualSpend, thresholdAmount: budget.thresholdAmount.toString(), enforced: false, jobStatus: null };
    }

    await this.audit.record({
      actorId: "system:budget",
      actorRole: "system",
      action: "budget.threshold-crossed",
      targetId: tenantId,
      details: { period, actualSpend, thresholdAmount: budget.thresholdAmount.toString() },
    });

    if (!budget.enforcementResourceId || !budget.enforcementDesiredState) {
      return { crossed: true, actualSpend, thresholdAmount: budget.thresholdAmount.toString(), enforced: false, jobStatus: null };
    }

    // Enforcement runs as a real plan (M09) through the durable executor
    // (M12) — the same mechanism every other Track M mutation in this
    // programme uses, never a direct prisma write to the target resource.
    const resourceId = budget.enforcementResourceId as string;
    const desiredState = budget.enforcementDesiredState as Record<string, unknown>;
    const plan = await this.planning.createPlan(resourceId, desiredState);
    const job = await this.executor.startJob(
      `budget-enforce-${tenantId}-${period}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      plan.id,
      resourceId,
      [
        {
          name: "apply-enforcement",
          run: async () => {
            await this.resources.setDesiredState(resourceId, desiredState);
            return { applied: desiredState };
          },
        },
      ],
    );

    return {
      crossed: true,
      actualSpend,
      thresholdAmount: budget.thresholdAmount.toString(),
      enforced: true,
      jobStatus: job.status,
    };
  }
}
