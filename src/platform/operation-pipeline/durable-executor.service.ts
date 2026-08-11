import { Injectable } from "@nestjs/common";
import { trace } from "@opentelemetry/api";
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
      // M34: the active OTel span's traceId, when tracing is running
      // (OTEL_EXPORTER_OTLP_ENDPOINT set — see tracing.ts), captured here
      // and folded into the SAME audit record every other pipeline step
      // already writes — not a second observability table. This is what
      // lets a console view join "which plan/job step" straight to "which
      // distributed trace in the existing Grafana/Tempo backend."
      const traceId = trace.getActiveSpan()?.spanContext().traceId ?? null;
      await audit.record({
        actorId: "system:pipeline",
        actorRole: "system",
        action: `pipeline.step.${info.stepName}`,
        targetId: info.resourceId,
        details: { jobId: info.jobId, planId: info.planId, stepIndex: info.stepIndex, traceId },
        correlationId: info.correlationId,
      });
    });
  }

  async startJob(
    jobId: string,
    planId: string | null,
    resourceId: string | null,
    definitions: JobStepDefinition[],
    correlationId: string | null = null,
  ): Promise<JobState> {
    return this.core.startJob(jobId, planId, resourceId, definitions, correlationId);
  }

  async resumeJob(jobId: string, definitions: JobStepDefinition[]): Promise<JobState> {
    return this.core.resumeJob(jobId, definitions);
  }
}
