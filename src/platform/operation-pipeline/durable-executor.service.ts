import { Injectable } from "@nestjs/common";
import type { JobState } from "./job-state-store";
import { PrismaJobStateStore } from "./prisma-job-state-store";
import { DurableExecutorCore, type JobStepDefinition } from "./durable-executor-core";
import { ControlPlaneAuditService } from "../v1/control-plane-audit.service";

export type { JobStepDefinition };

/**
 * M12/M14 — the NestJS-injectable entry point. All the actual algorithm
 * lives in `DurableExecutorCore` (no NestJS dependency), so it can also run
 * standalone in `kill-and-resume.worker.ts` for M12's real process-kill
 * proof. See that file's own comment for why.
 *
 * M14: the audit writer passed to the core is C03's real
 * `ControlPlaneAuditService.record()` — the same tamper-evident,
 * hash-chained log every other plane-1 mutation appends to (see M48). A
 * pipeline step's audit record is therefore indistinguishable, in that log,
 * from any other control-plane action, which is the point: "immutable
 * audit" names one spine, not a second log this phase invents.
 */
@Injectable()
export class DurableExecutorService {
  private readonly core: DurableExecutorCore;

  constructor(store: PrismaJobStateStore, audit: ControlPlaneAuditService) {
    this.core = new DurableExecutorCore(store, async (info) => {
      await audit.record({
        actorId: "system:pipeline",
        actorRole: "system",
        action: `pipeline.step.${info.stepName}`,
        targetId: info.resourceId,
        details: { jobId: info.jobId, planId: info.planId, stepIndex: info.stepIndex },
      });
    });
  }

  async startJob(
    jobId: string,
    planId: string | null,
    resourceId: string | null,
    definitions: JobStepDefinition[],
  ): Promise<JobState> {
    return this.core.startJob(jobId, planId, resourceId, definitions);
  }

  async resumeJob(jobId: string, definitions: JobStepDefinition[]): Promise<JobState> {
    return this.core.resumeJob(jobId, definitions);
  }
}
