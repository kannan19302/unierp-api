import { InjectQueue } from "@nestjs/bullmq";
import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { Queue } from "bullmq";

@Injectable()
export class PrivacyOperationsScheduler implements OnModuleInit {
  private readonly logger = new Logger(PrivacyOperationsScheduler.name);

  constructor(@InjectQueue("privacy-operations") private readonly queue: Queue) {}

  async onModuleInit() {
    const every = Number.parseInt(process.env.PRIVACY_SWEEP_INTERVAL_MS || "900000", 10);
    const interval = Number.isFinite(every) && every >= 60_000 ? every : 900_000;
    try {
      await this.queue.upsertJobScheduler(
        "privacy-operations-sweep",
        { every: interval },
        { name: "sweep", data: { kind: "sweep" } },
      );
      await this.queue.add(
        "sweep",
        { kind: "sweep" },
        { jobId: `privacy-bootstrap-${Date.now()}`, removeOnComplete: 100, removeOnFail: 500 },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (process.env.NODE_ENV === "production") throw error;
      this.logger.warn(`Privacy scheduler unavailable in development: ${message}`);
    }
  }
}
