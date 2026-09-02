import { InjectQueue, OnWorkerEvent, Processor, WorkerHost } from "@nestjs/bullmq";
import { Job, Queue } from "bullmq";
import { pinoLogger } from "../../../common/services/logger.service";
import { PrivacyOperationsService } from "./privacy-operations.service";

type PrivacyJob =
  | { kind: "sweep" }
  | { kind: "erase"; requestId: string; tenantId: string };

@Processor("privacy-operations", { concurrency: 2 })
export class PrivacyOperationsProcessor extends WorkerHost {
  constructor(
    private readonly operations: PrivacyOperationsService,
    @InjectQueue("privacy-operations") private readonly queue: Queue<PrivacyJob>,
  ) {
    super();
  }

  async process(job: Job<PrivacyJob>) {
    if (job.data.kind === "erase") {
      return this.operations.execute(job.data.requestId, job.data.tenantId);
    }

    const claimed = await this.operations.claimEligible(25);
    for (const request of claimed) {
      await this.queue.add(
        "erase",
        { kind: "erase", requestId: request.request_id, tenantId: request.tenant_id },
        {
          jobId: `erasure-${request.request_id}`,
          attempts: 5,
          backoff: { type: "exponential", delay: 30_000 },
          removeOnComplete: 1_000,
          removeOnFail: 5_000,
        },
      );
    }
    const purged = await this.operations.purgeExpiredExports(100);
    return { claimed: claimed.length, purgedExports: purged.length };
  }

  @OnWorkerEvent("failed")
  onFailed(job: Job<PrivacyJob> | undefined, error: Error) {
    pinoLogger.error(
      {
        queue: "privacy-operations",
        jobId: job?.id,
        kind: job?.data.kind,
        error: error.message,
      },
      "Privacy operation failed",
    );
  }
}
