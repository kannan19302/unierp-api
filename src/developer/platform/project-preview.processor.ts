import { OnWorkerEvent, Processor, WorkerHost } from "@nestjs/bullmq";
import type { Job } from "bullmq";
import { syncBackgroundJobStatus } from "../../common/queues/job-tracking.util";
import { ProjectPreviewService } from "./project-preview.service";

export interface DeveloperPreviewJobData {
  tenantId: string;
  projectId: string;
  previewId: string;
  requestedAt: string;
}

/** Durable admission point for preview sandbox preparation. The current adapter
 * validates and activates an isolated plan; future regional sandbox adapters
 * attach behind this worker without changing the public preview lifecycle. */
@Processor("developer-preview")
export class ProjectPreviewProcessor extends WorkerHost {
  constructor(private readonly previews: ProjectPreviewService) { super(); }

  async process(job: Job<DeveloperPreviewJobData>) {
    try {
      await job.updateProgress(15);
      const preview = await this.previews.prepare(job.data.tenantId, job.data.previewId);
      await job.updateProgress(100);
      return { previewId: preview.id, projectId: preview.projectId, status: preview.status };
    } catch (error) {
      // Leave the session pending while BullMQ still has retries; only the
      // terminal attempt makes the token permanently unusable.
      const attempts = job.opts?.attempts ?? 1;
      if ((job.attemptsMade ?? 0) >= attempts - 1) {
        await this.previews.failPreparation(job.data.tenantId, job.data.previewId);
      }
      throw error;
    }
  }

  @OnWorkerEvent("active") async onActive(job: Job<DeveloperPreviewJobData>) {
    await syncBackgroundJobStatus("developer-preview", String(job.id), { status: "ACTIVE" });
  }
  @OnWorkerEvent("completed") async onCompleted(job: Job<DeveloperPreviewJobData>, result: unknown) {
    await syncBackgroundJobStatus("developer-preview", String(job.id), { status: "COMPLETED", result });
  }
  @OnWorkerEvent("failed") async onFailed(job: Job<DeveloperPreviewJobData> | undefined, error: Error) {
    if (!job) return;
    await syncBackgroundJobStatus("developer-preview", String(job.id), { status: "FAILED", error: error?.message ?? "Preview preparation failed" });
  }
}
