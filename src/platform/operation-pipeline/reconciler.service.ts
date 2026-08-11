import { BadRequestException, Injectable } from "@nestjs/common";
import { prisma } from "@kannan19302/database";
import { ResourceModelService } from "../resource-model/resource-model.service";
import { DurableExecutorService } from "./durable-executor.service";
import { ControlPlaneAuditService } from "../v1/control-plane-audit.service";

export type HealingStrategy = (
  resourceId: string,
  desiredState: Record<string, unknown>,
) => Promise<void>;

export interface ReconciliationSummary {
  held: boolean;
  blastRadiusExceeded: boolean;
  candidateCount: number;
  healed: string[];
}

const DEFAULT_MAX_BLAST_RADIUS = 25;
const RECONCILER_ACTOR_ID = "system:reconciler";

/**
 * M13 — the continuous reconciler: converge actual toward desired.
 *
 * A resource is a healing candidate when M07 has an unresolved DriftRecord
 * for it — which already covers "deleted out of band" (an observed state
 * of `{ __deleted: true }`, reported via `reportObservedState`, diffs
 * against every real desired field and produces exactly that record).
 *
 * Every restoration runs as an M12 Job (durable, auditable on its own
 * terms) AND is recorded through `ControlPlaneAuditService` with
 * `actorId: "system:reconciler"` — the exit criterion's own requirement
 * that a restoration is "audited as a reconciliation rather than as an
 * operator action" is this one field: nothing here attributes a healing
 * action to whichever human last touched the resource.
 */
@Injectable()
export class ReconcilerService {
  private readonly strategies = new Map<string, HealingStrategy>();
  /** Not DI-injected on purpose: a primitive number has no injection token,
   *  and this value is operational tuning, not a dependency — set via
   *  setMaxBlastRadius() (tests use this directly). */
  private maxBlastRadius: number = DEFAULT_MAX_BLAST_RADIUS;

  constructor(
    private readonly resources: ResourceModelService,
    private readonly executor: DurableExecutorService,
    private readonly audit: ControlPlaneAuditService,
  ) {}

  setMaxBlastRadius(limit: number): void {
    this.maxBlastRadius = limit;
  }

  registerHealingStrategy(resourceKindName: string, strategy: HealingStrategy): void {
    this.strategies.set(resourceKindName, strategy);
  }

  async setHold(reason: string, setBy: string) {
    if (!reason) throw new BadRequestException("A reconciliation hold must record a reason");
    return (prisma as any).reconciliationHold.create({ data: { reason, setBy } });
  }

  async releaseHold(holdId: string) {
    return (prisma as any).reconciliationHold.update({
      where: { id: holdId },
      data: { releasedAt: new Date() },
    });
  }

  async isHeld(): Promise<boolean> {
    const active = await (prisma as any).reconciliationHold.findFirst({
      where: { releasedAt: null },
    });
    return !!active;
  }

  /**
   * The exit criterion's second half: "hits the blast-radius limit and
   * stops instead of rebuilding the estate." A single mis-set desired
   * state that fans out to dozens of drifted resources is exactly what a
   * blanket auto-heal would make WORSE — this refuses the entire cycle,
   * not a partial subset, once the candidate count crosses the limit.
   */
  async reconcile(): Promise<ReconciliationSummary> {
    if (await this.isHeld()) {
      return { held: true, blastRadiusExceeded: false, candidateCount: 0, healed: [] };
    }

    const candidates = await this.findDriftedResourceIds();

    if (candidates.length > this.maxBlastRadius) {
      return {
        held: false,
        blastRadiusExceeded: true,
        candidateCount: candidates.length,
        healed: [],
      };
    }

    const healed: string[] = [];
    for (const resourceId of candidates) {
      await this.healOne(resourceId);
      healed.push(resourceId);
    }

    return { held: false, blastRadiusExceeded: false, candidateCount: candidates.length, healed };
  }

  private async findDriftedResourceIds(): Promise<string[]> {
    const openDrift = await (prisma as any).driftRecord.findMany({
      where: { resolved: false },
      select: { resourceId: true },
    });
    return [...new Set(openDrift.map((d: any) => d.resourceId))] as string[];
  }

  private async healOne(resourceId: string): Promise<void> {
    const resource = await (prisma as any).resource.findUnique({
      where: { id: resourceId },
      include: { kind: true },
    });
    if (!resource) return;

    const strategy = this.strategies.get(resource.kind.name);
    if (!strategy) {
      throw new BadRequestException(
        `No healing strategy registered for resource kind "${resource.kind.name}" — cannot reconcile "${resource.name}"`,
      );
    }

    const desired = await this.resources.getDesiredState(resourceId);
    const desiredState = (desired?.state as Record<string, unknown>) ?? {};

    const job = await this.executor.startJob(
      `reconcile-${resourceId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      null,
      resourceId,
      [
        {
          name: "heal-resource",
          run: async () => {
            await strategy(resourceId, desiredState);
            return { healed: true };
          },
        },
      ],
    );

    await this.audit.record({
      actorId: RECONCILER_ACTOR_ID,
      actorRole: "system",
      action: "reconciliation.restore",
      targetId: resourceId,
      details: { jobId: job.id, jobStatus: job.status, resourceKind: resource.kind.name },
    });

    if (job.status !== "HALTED") {
      const open = await this.resources.getOpenDrift(resourceId);
      for (const drift of open) {
        await this.resources.resolveDrift(drift.id);
      }
      await this.resources.reportObservedState(resourceId, desiredState);
    }
  }
}
