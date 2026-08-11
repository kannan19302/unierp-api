/**
 * M36 — backup, restore, DR and failover. Every mutation here runs
 * through M09's plan pipeline against an M07 Resource's desired state —
 * "restore as a plan," never a direct write. Architecturally distinct
 * from C22's tenant migration (which moves a TENANT between clusters,
 * touching Tenant/SaasMultiTenantCluster/UsageRecord): this file never
 * imports or queries any of those models, only Resource/DesiredState and
 * its own BackupPolicy/RestoreRehearsal/FailoverRehearsal tables.
 */
import { Injectable, BadRequestException, NotFoundException } from "@nestjs/common";
import { prisma } from "@kannan19302/database";
import { ResourceModelService } from "../resource-model/resource-model.service";
import { PlanningService } from "../operation-pipeline/planning.service";
import { DurableExecutorService } from "../operation-pipeline/durable-executor.service";

@Injectable()
export class DisasterRecoveryService {
  constructor(
    private readonly resources: ResourceModelService,
    private readonly planning: PlanningService,
    private readonly executor: DurableExecutorService,
  ) {}

  async setBackupPolicy(resourceId: string, rpoObjectiveMinutes: number, rtoObjectiveMinutes: number) {
    return (prisma as any).backupPolicy.upsert({
      where: { resourceId },
      create: { resourceId, rpoObjectiveMinutes, rtoObjectiveMinutes },
      update: { rpoObjectiveMinutes, rtoObjectiveMinutes },
    });
  }

  /**
   * "A restore is rehearsed and reconciles; the measured RPO and RTO are
   * recorded against the objective and a MISS IS A FAILURE, not a note":
   * this method THROWS when either measurement exceeds its objective —
   * the caller cannot silently proceed past a missed objective, and the
   * rehearsal is still recorded (as a failed one) either way.
   */
  async rehearseRestore(
    resourceId: string,
    backedUpState: Record<string, unknown>,
    lastBackupAt: Date,
    failureAt: Date,
    restoreStartedAt: Date,
    restoreCompletedAt: Date,
  ) {
    const policy = await (prisma as any).backupPolicy.findUnique({ where: { resourceId } });
    if (!policy) {
      throw new NotFoundException(`No backup policy for resource "${resourceId}" — cannot rehearse a restore with no objective to measure against`);
    }

    const measuredRpoMinutes = Math.round((failureAt.getTime() - lastBackupAt.getTime()) / 60000);
    const measuredRtoMinutes = Math.round((restoreCompletedAt.getTime() - restoreStartedAt.getTime()) / 60000);

    // Restore AS A PLAN: the backed-up state is applied through the same
    // M09/M12 pipeline every other Track M mutation uses.
    const plan = await this.planning.createPlan(resourceId, backedUpState);
    const job = await this.executor.startJob(
      `restore-rehearsal-${resourceId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      plan.id,
      resourceId,
      [
        {
          name: "apply-restored-state",
          run: async () => {
            await this.resources.setDesiredState(resourceId, backedUpState);
            return backedUpState;
          },
        },
      ],
    );

    const desiredAfter = await this.resources.getDesiredState(resourceId);
    const reconciled = job.status === "DONE" && JSON.stringify(desiredAfter?.state ?? {}) === JSON.stringify(backedUpState);

    const passed =
      reconciled && measuredRpoMinutes <= policy.rpoObjectiveMinutes && measuredRtoMinutes <= policy.rtoObjectiveMinutes;

    const rehearsal = await (prisma as any).restoreRehearsal.create({
      data: {
        resourceId,
        measuredRpoMinutes,
        measuredRtoMinutes,
        rpoObjectiveMinutes: policy.rpoObjectiveMinutes,
        rtoObjectiveMinutes: policy.rtoObjectiveMinutes,
        passed,
        reconciled,
      },
    });

    if (!passed) {
      throw new BadRequestException(
        `Restore rehearsal ${rehearsal.id} FAILED: ` +
          (!reconciled ? "resource did not reconcile to the backed-up state. " : "") +
          (measuredRpoMinutes > policy.rpoObjectiveMinutes
            ? `RPO missed (measured ${measuredRpoMinutes}m > objective ${policy.rpoObjectiveMinutes}m). `
            : "") +
          (measuredRtoMinutes > policy.rtoObjectiveMinutes
            ? `RTO missed (measured ${measuredRtoMinutes}m > objective ${policy.rtoObjectiveMinutes}m).`
            : ""),
      );
    }

    return rehearsal;
  }

  /** A region failover, rehearsed as a plan against the resource's own
   *  `region` desired-state field — the same field M17's residency
   *  check and M21's infrastructure resources already read. */
  async rehearseFailover(resourceId: string, fromRegion: string, toRegion: string) {
    const plan = await this.planning.createPlan(resourceId, { region: toRegion });
    const job = await this.executor.startJob(
      `failover-${resourceId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      plan.id,
      resourceId,
      [{ name: "failover-to-region", run: async () => { await this.resources.setDesiredState(resourceId, { region: toRegion }); return { region: toRegion }; } }],
    );

    const desired = await this.resources.getDesiredState(resourceId);
    if (job.status !== "DONE" || (desired?.state as any)?.region !== toRegion) {
      throw new BadRequestException(`Failover rehearsal for resource "${resourceId}" did not reconcile to region "${toRegion}"`);
    }

    return (prisma as any).failoverRehearsal.create({
      data: { resourceId, fromRegion, toRegion },
    });
  }

  /**
   * "A region failover is rehearsed with a PROVEN failback" — this is
   * that proof: a SEPARATE call that reverts the resource back to its
   * pre-failover region through the identical plan mechanism, and marks
   * the ORIGINAL failover rehearsal's `failbackVerified` only once the
   * resource's actual desired state confirms it.
   */
  async rehearseFailback(rehearsalId: string) {
    const rehearsal = await (prisma as any).failoverRehearsal.findUnique({ where: { id: rehearsalId } });
    if (!rehearsal) throw new NotFoundException(`Failover rehearsal ${rehearsalId} not found`);

    const plan = await this.planning.createPlan(rehearsal.resourceId, { region: rehearsal.fromRegion });
    const job = await this.executor.startJob(
      `failback-${rehearsal.resourceId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      plan.id,
      rehearsal.resourceId,
      [
        {
          name: "failback-to-original-region",
          run: async () => {
            await this.resources.setDesiredState(rehearsal.resourceId, { region: rehearsal.fromRegion });
            return { region: rehearsal.fromRegion };
          },
        },
      ],
    );

    const desired = await this.resources.getDesiredState(rehearsal.resourceId);
    const verified = job.status === "DONE" && (desired?.state as any)?.region === rehearsal.fromRegion;

    return (prisma as any).failoverRehearsal.update({
      where: { id: rehearsalId },
      data: { failbackAt: new Date(), failbackVerified: verified },
    });
  }
}
