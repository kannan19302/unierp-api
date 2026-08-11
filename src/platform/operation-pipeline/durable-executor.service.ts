import { Injectable } from "@nestjs/common";
import type { JobState, JobStateStore } from "./job-state-store";
import { PrismaJobStateStore } from "./prisma-job-state-store";
import { DurableExecutorCore, type JobStepDefinition } from "./durable-executor-core";

export type { JobStepDefinition };

/**
 * M12 — the NestJS-injectable entry point. All the actual algorithm lives
 * in `DurableExecutorCore` (no NestJS dependency), so it can also run
 * standalone in `kill-and-resume.worker.ts` for the exit criterion's real
 * process-kill proof. See that file's own comment for why.
 */
@Injectable()
export class DurableExecutorService {
  private readonly core: DurableExecutorCore;

  constructor(store: PrismaJobStateStore) {
    this.core = new DurableExecutorCore(store);
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
