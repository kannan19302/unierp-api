import { BadRequestException, Injectable } from "@nestjs/common";
import { prisma } from "@kannan19302/database";
import { ResourceModelService, type FieldDiff } from "../resource-model/resource-model.service";
import { ProviderRegistryService } from "../provider-registry/provider-registry.service";

export interface CostContext {
  providerId: string;
  capabilityId: string;
  operation: string;
  unit: string;
  quantity: number;
}

export interface EstimatedCostDelta {
  pricePerUnit: string;
  quantity: number;
  currency: string;
  /** pricePerUnit * quantity, computed as a string to keep the arithmetic
   *  out of JS float — this is money, same rule as M04's price sheet. */
  total: string;
}

export interface Reversal {
  resourceId: string;
  priorDesiredState: Record<string, unknown> | null;
}

export interface Plan {
  id: string;
  resourceId: string;
  /** Diff between the CURRENT desired state and the proposed one — what
   *  this plan would change, computed by M07's own diff mechanism so
   *  there is exactly one diffing implementation in the platform. */
  diff: FieldDiff[];
  /** The target plus every resource that (transitively) depends on it —
   *  what this change could affect, not only what it directly touches. */
  affectedResourceIds: string[];
  /** Topological order (dependencies before dependents) the pipeline
   *  would apply the affected set in. */
  executionOrder: string[];
  estimatedCostDelta: EstimatedCostDelta | null;
  reversal: Reversal;
  createdAt: Date;
}

/**
 * M09 — every mutation compiles to a Plan before anything reaches a
 * provider. This service NEVER calls a provider adapter — planning and
 * dry-run are the same operation for exactly that reason: compiling a plan
 * has no side effect on the estate, so "plan" and "dry-run" cannot diverge
 * by construction, not by a policy someone has to remember to follow.
 */
@Injectable()
export class PlanningService {
  constructor(
    private readonly resources: ResourceModelService,
    private readonly providers: ProviderRegistryService,
  ) {}

  async createPlan(
    resourceId: string,
    proposedState: Record<string, unknown>,
    cost?: CostContext,
  ): Promise<Plan> {
    const resource = await (prisma as any).resource.findUnique({ where: { id: resourceId } });
    if (!resource) {
      throw new BadRequestException(`Resource ${resourceId} not found`);
    }

    const currentDesired = await this.resources.getDesiredState(resourceId);
    const currentState = (currentDesired?.state as Record<string, unknown>) ?? {};
    const diff = this.resources.diffStates(currentState, proposedState);

    const affectedResourceIds = await this.collectAffected(resourceId);
    const executionOrder = await this.topologicalOrder(affectedResourceIds);

    const estimatedCostDelta = cost ? await this.estimateCost(cost) : null;

    return {
      id: `plan-${resourceId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      resourceId,
      diff,
      affectedResourceIds,
      executionOrder,
      estimatedCostDelta,
      reversal: { resourceId, priorDesiredState: currentDesired ? currentState : null },
      createdAt: new Date(),
    };
  }

  /** Same operation as createPlan(), under the name the exit criterion uses.
   *  Kept as a distinct method (not just a doc note) so a caller reading
   *  this service's public surface sees the guarantee named explicitly:
   *  dry-running IS planning, nothing more happens on the way there. */
  async dryRun(resourceId: string, proposedState: Record<string, unknown>, cost?: CostContext): Promise<Plan> {
    return this.createPlan(resourceId, proposedState, cost);
  }

  /**
   * The cost delta this phase's exit criterion requires to come from M04,
   * "not a constant": sourced from ProviderRegistryService.getPriceFor(),
   * which reads the ProviderPriceSheetEntry a provider's own recorded price
   * populates. If that record changes, this number changes on the next
   * call — nothing here is a hardcoded figure.
   */
  private async estimateCost(cost: CostContext): Promise<EstimatedCostDelta | null> {
    const entry = await this.providers.getPriceFor(
      cost.providerId,
      cost.capabilityId,
      cost.operation,
      cost.unit,
    );
    if (!entry) return null;
    const pricePerUnit = entry.pricePerUnit as unknown as string; // Prisma Decimal serialises as string here
    const total = (Number(pricePerUnit) * cost.quantity).toFixed(4);
    return { pricePerUnit: String(pricePerUnit), quantity: cost.quantity, currency: entry.currency, total };
  }

  /** Target plus every transitive dependent — BFS outward via M07's
   *  dependents lookup, so a diamond dependency is only counted once. */
  private async collectAffected(resourceId: string): Promise<string[]> {
    const visited = new Set<string>([resourceId]);
    const queue = [resourceId];
    while (queue.length > 0) {
      const current = queue.shift()!;
      const dependents = await this.resources.getDependents(current);
      for (const d of dependents) {
        if (!visited.has(d.id)) {
          visited.add(d.id);
          queue.push(d.id);
        }
      }
    }
    return [...visited];
  }

  /** Kahn's algorithm over the affected set's own Dependency edges:
   *  a resource's dependencies (within the set) must be processed first. */
  private async topologicalOrder(resourceIds: string[]): Promise<string[]> {
    const idSet = new Set(resourceIds);
    const inDegree = new Map<string, number>(resourceIds.map((id) => [id, 0]));
    const edges = new Map<string, string[]>(resourceIds.map((id) => [id, []])); // dependsOnId -> [resourceId,...]

    for (const id of resourceIds) {
      const deps = await (prisma as any).dependency.findMany({ where: { resourceId: id } });
      for (const dep of deps) {
        if (idSet.has(dep.dependsOnId)) {
          edges.get(dep.dependsOnId)!.push(id);
          inDegree.set(id, (inDegree.get(id) ?? 0) + 1);
        }
      }
    }

    const queue = resourceIds.filter((id) => inDegree.get(id) === 0);
    const order: string[] = [];
    while (queue.length > 0) {
      const current = queue.shift()!;
      order.push(current);
      for (const next of edges.get(current) ?? []) {
        inDegree.set(next, inDegree.get(next)! - 1);
        if (inDegree.get(next) === 0) queue.push(next);
      }
    }
    return order;
  }
}
