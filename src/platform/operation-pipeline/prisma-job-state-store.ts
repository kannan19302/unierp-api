import { Injectable } from "@nestjs/common";
import { prisma } from "@kannan19302/database";
import type { JobState, JobStateStore, StepRecord } from "./job-state-store";

/** M12's production JobStateStore, backed by the Job model. */
@Injectable()
export class PrismaJobStateStore implements JobStateStore {
  async createJob(
    id: string,
    planId: string | null,
    resourceId: string | null,
    steps: StepRecord[],
  ): Promise<JobState> {
    const row = await (prisma as any).job.create({
      data: { id, planId, resourceId, status: "PENDING", stepIndex: 0, steps },
    });
    return this.fromRow(row);
  }

  async loadJob(id: string): Promise<JobState | null> {
    const row = await (prisma as any).job.findUnique({ where: { id } });
    return row ? this.fromRow(row) : null;
  }

  async saveState(job: JobState): Promise<void> {
    await (prisma as any).job.update({
      where: { id: job.id },
      data: { status: job.status, stepIndex: job.stepIndex, steps: job.steps },
    });
  }

  private fromRow(row: any): JobState {
    return {
      id: row.id,
      planId: row.planId,
      resourceId: row.resourceId,
      status: row.status,
      stepIndex: row.stepIndex,
      steps: row.steps,
    };
  }
}
