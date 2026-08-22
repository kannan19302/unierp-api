import { OnWorkerEvent, Processor, WorkerHost } from "@nestjs/bullmq";
import type { Job } from "bullmq";
import { syncBackgroundJobStatus } from "../../common/queues/job-tracking.util";
import { ProjectReleasesService } from "./project-releases.service";
import type { DeveloperBuildJobData } from "./developer-builds.service";
import { DeveloperWorkloadMeteringService } from "./developer-workload-metering.service";

/** Worker boundary for deterministic project validation/build evidence. */
@Processor("developer-build")
export class DeveloperBuildProcessor extends WorkerHost {
  constructor(private readonly releases: ProjectReleasesService, private readonly metering?: DeveloperWorkloadMeteringService) { super(); }

  async process(job: Job<DeveloperBuildJobData>) {
    await job.updateProgress(10);
    const validation = await this.releases.validate({
      tenantId: job.data.tenantId,
      projectId: job.data.projectId,
      startedBy: job.data.startedBy ?? null,
    });
    await this.metering?.record({ tenantId: job.data.tenantId, metric: "DEVELOPER_VALIDATION_BUILD", workloadId: String(job.id), projectId: job.data.projectId });
    await job.updateProgress(100);
    return { validationId: validation.id, status: validation.status, score: validation.score, sourceFingerprint: validation.sourceFingerprint };
  }

  @OnWorkerEvent("active")
  async onActive(job: Job<DeveloperBuildJobData>) {
    await syncBackgroundJobStatus("developer-build", String(job.id), { status: "ACTIVE" });
  }

  @OnWorkerEvent("completed")
  async onCompleted(job: Job<DeveloperBuildJobData>, result: unknown) {
    await syncBackgroundJobStatus("developer-build", String(job.id), { status: "COMPLETED", result });
  }

  @OnWorkerEvent("failed")
  async onFailed(job: Job<DeveloperBuildJobData> | undefined, error: Error) {
    if (!job) return;
    await syncBackgroundJobStatus("developer-build", String(job.id), { status: "FAILED", error: error?.message ?? "Developer build failed" });
  }
}
