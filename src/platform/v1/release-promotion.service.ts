/**
 * M20 — environments as resources, with promotion as a plan carrying a
 * health gate. C27's stated invariant ("a rollback is the previous
 * manifest") existed only as a manually-triggered audit record before
 * this phase (`ReleaseControlService.triggerRollback`, left unmodified —
 * C27 keeps its surface). This service is what "executed by the pipeline
 * rather than by hand" means as code: the health-gate step's failure
 * triggers M12's own compensate-on-failure walk, which is what reverts
 * the environment's desired state back to the manifest version it held
 * before the promotion — not a second, bespoke rollback path.
 */
import { Injectable } from "@nestjs/common";
import { ResourceModelService } from "../resource-model/resource-model.service";
import { PlanningService } from "../operation-pipeline/planning.service";
import { DurableExecutorService } from "../operation-pipeline/durable-executor.service";

const RESOURCE_KIND = "environment-release";

export type HealthCheck = () => Promise<boolean>;

@Injectable()
export class ReleasePromotionService {
  constructor(
    private readonly resources: ResourceModelService,
    private readonly planning: PlanningService,
    private readonly executor: DurableExecutorService,
  ) {}

  private async getOrCreateEnvironmentResource(environmentName: string): Promise<{ id: string }> {
    await this.resources.registerResourceKind(RESOURCE_KIND, "An environment's currently deployed release manifest");
    const { items } = await this.resources.searchResources({ kindName: RESOURCE_KIND, limit: 100 });
    const existing = items.find((r) => r.name === environmentName);
    if (existing) return existing;
    return this.resources.createResource(RESOURCE_KIND, environmentName, { manifestVersion: null });
  }

  /**
   * Compiles a plan for the promotion, runs it as a durable job with a
   * "deploy-manifest" step and a "health-gate" step, and returns the job's
   * final state. If the health gate fails, `deploy-manifest`'s compensator
   * runs automatically — the environment's desired state (and this
   * promotion's own record of what happened) show a manifest reverted to
   * whatever it held before this call, never left mid-promotion.
   */
  async promote(environmentName: string, targetManifestVersion: string, healthCheck: HealthCheck) {
    const resource = await this.getOrCreateEnvironmentResource(environmentName);
    const priorDesired = await this.resources.getDesiredState(resource.id);
    const priorVersion = (priorDesired?.state as any)?.manifestVersion ?? null;

    const plan = await this.planning.createPlan(resource.id, { manifestVersion: targetManifestVersion });

    const job = await this.executor.startJob(
      `promote-${resource.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      plan.id,
      resource.id,
      [
        {
          name: "deploy-manifest",
          run: async () => {
            await this.resources.setDesiredState(resource.id, { manifestVersion: targetManifestVersion });
            return { manifestVersion: targetManifestVersion };
          },
          compensate: async () => {
            // C27's invariant, executed rather than described: the
            // rollback target is exactly the manifest this environment
            // held immediately before this promotion, read from the same
            // desired-state history M14 already keeps — not recomputed or
            // guessed from a log line.
            await this.resources.setDesiredState(resource.id, { manifestVersion: priorVersion });
          },
        },
        {
          name: "health-gate",
          run: async () => {
            const healthy = await healthCheck();
            if (!healthy) {
              throw new Error(`Health gate failed for environment "${environmentName}" on manifest "${targetManifestVersion}"`);
            }
            return { healthy: true };
          },
        },
      ],
    );

    return { job, resourceId: resource.id, priorVersion, targetManifestVersion, promoted: job.status === "DONE" };
  }
}
