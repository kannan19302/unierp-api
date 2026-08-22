import { InjectQueue } from "@nestjs/bullmq";
import { Injectable } from "@nestjs/common";
import type { Queue } from "bullmq";
import { prisma } from "@kannan19302/database";
import { enqueueTrackedJob } from "../../common/queues/job-tracking.util";

export interface DeveloperBuildJobData {
  tenantId: string;
  projectId: string;
  startedBy?: string | null;
  requestedAt: string;
}

/**
 * Durable build admission.  The queue row is intentionally the existing
 * BackgroundJob record, rather than a second competing task model: operators
 * get retries, lifecycle state and tenant cost attribution in one place.
 */
@Injectable()
export class DeveloperBuildsService {
  private readonly db = prisma as any;
  constructor(@InjectQueue("developer-build") private readonly queue: Queue) {}

  async enqueue(input: Omit<DeveloperBuildJobData, "requestedAt">) {
    return enqueueTrackedJob(this.queue, {
      tenantId: input.tenantId,
      jobType: "validate-project-composition",
      payload: { ...input, requestedAt: new Date().toISOString() },
      priority: 5,
    });
  }

  list(tenantId: string, projectId: string) {
    return this.db.backgroundJob.findMany({
      where: {
        tenantId,
        queueName: "developer-build",
        payload: { path: ["projectId"], equals: projectId },
      },
      select: { id: true, bullJobId: true, jobType: true, status: true, result: true, error: true, attempts: true, createdAt: true, startedAt: true, completedAt: true },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
  }
}
