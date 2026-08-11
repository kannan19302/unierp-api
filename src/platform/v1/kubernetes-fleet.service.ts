/**
 * M19 — the fleet's routing weight, changed through the real pipeline
 * instead of the direct write `SaasClusterRoutingDeepService.setTenantRouting`
 * performed. That method still exists (M06's own surface) and is left
 * alone; this file gives the console a SECOND path for the one mutation
 * this phase's exit criterion names — plan, approve, execute as a durable
 * job, reconcile the actual routing table — and the console's Kubernetes
 * page is wired to this path, not the direct one.
 *
 * The routing weight is modelled as an M07 Resource (kind
 * "cluster-routing-weight") so it inherits M14's versioning for free: a
 * rollback is just PlanningService.rollback() against this resource,
 * proposing the historical weight through the exact same propose/approve/
 * apply cycle as any other change — never a special "undo" code path.
 */
import { Injectable, NotFoundException } from "@nestjs/common";
import { prisma } from "@kannan19302/database";
import { ResourceModelService } from "../resource-model/resource-model.service";
import { PlanningService, type Plan } from "../operation-pipeline/planning.service";
import { SchedulingService } from "../operation-pipeline/scheduling.service";
import { DurableExecutorService } from "../operation-pipeline/durable-executor.service";

const RESOURCE_KIND = "cluster-routing-weight";

@Injectable()
export class KubernetesFleetService {
  constructor(
    private readonly resources: ResourceModelService,
    private readonly planning: PlanningService,
    private readonly scheduling: SchedulingService,
    private readonly executor: DurableExecutorService,
  ) {}

  private async getOrCreateRoutingResource(tenantId: string, clusterId: string) {
    await this.resources.registerResourceKind(RESOURCE_KIND, "A tenant's routing weight against one cluster");
    const name = `${tenantId}::${clusterId}`;
    const existing = await (prisma as any).resource.findFirst({ where: { name } });
    if (existing) return existing;
    // The routing row itself is M06's own surface (createCluster +
    // setTenantRouting establish it); this phase only governs how its
    // WEIGHT changes going forward, so a resource cannot be created for a
    // routing pair that doesn't exist yet.
    const current = await (prisma as any).saasTenantNodeRouting.findFirst({ where: { tenantId, clusterId } });
    if (!current) {
      throw new NotFoundException(
        `No routing exists for tenant "${tenantId}" on cluster "${clusterId}" — establish it via M06's cluster routing first`,
      );
    }
    return this.resources.createResource(RESOURCE_KIND, name, { weight: current.weight });
  }

  /**
   * Step 1 of the pipeline: compile the plan and request approval. Nothing
   * is applied to the actual routing table yet — that only happens once an
   * approval decides APPROVED and `applyRoutingWeight` runs the durable job.
   */
  async proposeRoutingWeight(tenantId: string, clusterId: string, weight: number, requestedBy: string) {
    const resource = await this.getOrCreateRoutingResource(tenantId, clusterId);
    const plan = await this.planning.createPlan(resource.id, { weight }, undefined, tenantId);
    const approval = await this.scheduling.requestApproval(plan, requestedBy);
    return { resourceId: resource.id, plan, approval };
  }

  /**
   * Step 2: decide the approval (C04's own separation-of-duties rule
   * applies unmodified — a different operator than the requester), then
   * run the change as a durable job. The job's step writes BOTH the M07
   * desired state (so M14 versions it) and the actual
   * SaasTenantNodeRouting row (so the fleet's real routing reflects it) —
   * "reconciled" here means the job's own step performs the convergence,
   * the same act M13's reconciler performs for drift found later.
   */
  async applyRoutingWeight(
    approvalId: string,
    resourceId: string,
    tenantId: string,
    clusterId: string,
    weight: number,
    decidedBy: string,
  ) {
    await this.scheduling.decideApproval(approvalId, decidedBy, "APPROVED");

    const resource = await (prisma as any).resource.findUnique({ where: { id: resourceId } });
    if (!resource) throw new NotFoundException(`Resource ${resourceId} not found`);

    const priorDesired = await this.resources.getDesiredState(resourceId);
    const priorWeight = (priorDesired?.state as any)?.weight;
    const priorRow = await (prisma as any).saasTenantNodeRouting.findFirst({ where: { tenantId, clusterId } });
    if (!priorRow) {
      throw new NotFoundException(`No routing row for tenant "${tenantId}" on cluster "${clusterId}"`);
    }

    const job = await this.executor.startJob(
      `routing-weight-${resourceId}-${Date.now()}`,
      null,
      resourceId,
      [
        {
          name: "apply-routing-weight",
          run: async () => {
            await this.resources.setDesiredState(resourceId, { weight });
            await (prisma as any).saasTenantNodeRouting.update({
              where: { tenantId_clusterId: { tenantId, clusterId } },
              data: { weight },
            });
            return { weight };
          },
          compensate: async () => {
            if (priorWeight !== undefined) {
              await this.resources.setDesiredState(resourceId, { weight: priorWeight });
            }
            await (prisma as any).saasTenantNodeRouting.update({
              where: { tenantId_clusterId: { tenantId, clusterId } },
              data: { weight: priorRow.weight },
            });
          },
        },
      ],
    );

    return { job, weight };
  }

  /**
   * "Reverts on rollback" — M14's own rollback() reads a prior
   * DesiredStateVersion and hands its state back through createPlan().
   * That plan then goes through the SAME propose/approve/apply cycle as
   * any forward change: a rollback is not a bypass of approval.
   */
  async rollbackRoutingWeight(resourceId: string, targetVersion: number, requestedBy: string): Promise<Plan> {
    return this.planning.rollback(resourceId, targetVersion);
  }

  async listRoutingWeights(clusterId?: string) {
    return (prisma as any).saasTenantNodeRouting.findMany({
      where: clusterId ? { clusterId } : undefined,
    });
  }
}
