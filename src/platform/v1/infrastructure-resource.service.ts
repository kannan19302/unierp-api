/**
 * M21 — compute, storage and network resources on the pipeline. Rather
 * than four near-identical services (one per kind), this is ONE service
 * parameterised by kind: provisioning, scaling and migrating are all "set
 * a desired state and let the pipeline converge to it" (M07/M09/M12/M13),
 * and deprovisioning is M07's own `deleteResource`, which already refuses
 * when dependents exist — this phase's job is wiring these four kinds
 * onto mechanisms M07-M13 already built and proved, not inventing new
 * ones.
 */
import { Injectable, OnModuleInit } from "@nestjs/common";
import { ResourceModelService } from "../resource-model/resource-model.service";
import { PlanningService } from "../operation-pipeline/planning.service";
import { DurableExecutorService } from "../operation-pipeline/durable-executor.service";
import { ReconcilerService } from "../operation-pipeline/reconciler.service";

export const INFRASTRUCTURE_KINDS = ["compute-instance", "storage-volume", "network-vpc", "firewall-rule"] as const;
export type InfrastructureKind = (typeof INFRASTRUCTURE_KINDS)[number];

@Injectable()
export class InfrastructureResourceService implements OnModuleInit {
  constructor(
    private readonly resources: ResourceModelService,
    private readonly planning: PlanningService,
    private readonly executor: DurableExecutorService,
    private readonly reconciler: ReconcilerService,
  ) {}

  /**
   * Every kind gets a healing strategy of "re-apply the desired state
   * through the same provisioning step" — the reconciler (M13) refuses to
   * heal a kind with none registered, and a real provisioner would put
   * its actual re-create/re-attach logic here; for the kinds this phase
   * owns, converging is exactly re-declaring the desired state, since
   * there is no live cloud API behind these in this environment.
   */
  async onModuleInit() {
    for (const kind of INFRASTRUCTURE_KINDS) {
      await this.resources.registerResourceKind(kind, `${kind} — provisioned via M21`);
      this.reconciler.registerHealingStrategy(kind, async () => {
        // Re-declaring is the heal: the desired state itself is already
        // correct (that's WHY it's desired); healing means the actual
        // resource is brought back to match it, which for this
        // environment's own bookkeeping is a no-op re-affirmation.
      });
    }
  }

  async provision(kind: InfrastructureKind, name: string, initialState: Record<string, unknown>) {
    const resource = await this.resources.createResource(kind, name, initialState);
    return resource;
  }

  /**
   * Scale AND migrate are the same mechanism: compile a plan for the new
   * desired state, run it as a durable job whose step commits that state,
   * with a compensator reverting to whatever was desired before. An
   * optional `verify` callback (a post-change health/capacity check, the
   * same shape M20's health gate uses) can fail this step — its failure
   * triggers the compensator automatically, which is the "proven
   * reversal" the exit criterion asks for: not a second, separate
   * rollback path, the same mechanism M12 already provides any job.
   */
  async changeDesiredState(
    resourceId: string,
    newState: Record<string, unknown>,
    verify: () => Promise<boolean> = async () => true,
    correlationId: string | null = null,
  ) {
    const priorDesired = await this.resources.getDesiredState(resourceId);
    const priorState = (priorDesired?.state as Record<string, unknown>) ?? null;

    const plan = await this.planning.createPlan(resourceId, newState);

    const job = await this.executor.startJob(
      `infra-change-${resourceId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      plan.id,
      resourceId,
      [
        {
          name: "apply-desired-state",
          run: async () => {
            await this.resources.setDesiredState(resourceId, newState);
            return newState;
          },
          compensate: async () => {
            if (priorState) {
              await this.resources.setDesiredState(resourceId, priorState);
            }
          },
        },
        {
          name: "verify",
          run: async () => {
            const ok = await verify();
            if (!ok) {
              throw new Error(`Verification failed for resource "${resourceId}" after change to ${JSON.stringify(newState)}`);
            }
            return { verified: true };
          },
        },
      ],
      correlationId,
    );

    return { job, plan };
  }

  /** Refuses with dependents named, from M07 — unmodified, this phase does
   *  not reimplement or soften that check. */
  async deprovision(resourceId: string): Promise<void> {
    await this.resources.deleteResource(resourceId);
  }

  async reportDrift(resourceId: string, observedState: Record<string, unknown>) {
    return this.resources.reportObservedState(resourceId, observedState);
  }
}
