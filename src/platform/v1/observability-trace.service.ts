/**
 * M34 — one correlated view from the console click to the provider call.
 * This service stores nothing of its own: it reads exactly the audit
 * records `ControlPlaneAuditInterceptor` (the "console click," C03/M48)
 * and `DurableExecutorService`'s own audit writer (each "provider call,"
 * M12/M14/M34) already write to the SAME `ControlPlaneAuditLog` table,
 * joined by the one `correlationId` both sides already carry. No second
 * trace store, no duplicated telemetry pipeline — "wired to the existing
 * Grafana/OTel backends rather than duplicating them" means the actual
 * span/log DATA still lives there; this assembles the ORDER and
 * OUTCOME of what happened from records this platform already keeps,
 * and links out to Grafana/Tempo via the captured OTel traceId for the
 * raw signal.
 */
import { Injectable } from "@nestjs/common";
import { prisma } from "@kannan19302/database";

export interface CorrelatedTraceEvent {
  auditLogId: string;
  actorId: string;
  action: string;
  targetId: string | null;
  details: Record<string, unknown>;
  createdAt: Date;
}

export interface FailedStepInfo {
  jobId: string;
  resourceId: string | null;
  stepName: string;
  error: string;
}

export interface CorrelatedTrace {
  correlationId: string;
  events: CorrelatedTraceEvent[];
  /** The failing pipeline step, if any -- the exact "provider call" a
   *  failed plan actually broke on, named from the Job's own step
   *  record (which carries the real error message; the audit trail
   *  alone does not, since the audit write happens BEFORE a step runs,
   *  by M14's own design). */
  failedAt: FailedStepInfo | null;
  /** Deep link into the existing Grafana instance, scoped to this
   *  correlation id -- built from configuration, never fabricated data. */
  grafanaUrl: string | null;
  /** Deep link into the existing Tempo/trace backend, when an OTel span
   *  was active during execution (see DurableExecutorService). */
  traceUrl: string | null;
}

@Injectable()
export class ObservabilityTraceService {
  /**
   * One query, one correlationId, ordered by time — "the console click to
   * the provider call in one correlated view" is this method's return
   * value, not a UI assembling several separate calls.
   */
  async getCorrelatedTrace(correlationId: string): Promise<CorrelatedTrace> {
    const rows = await (prisma as any).controlPlaneAuditLog.findMany({
      where: { correlationId },
      orderBy: { sequenceNum: "asc" },
    });

    const events: CorrelatedTraceEvent[] = rows.map((r: any) => ({
      auditLogId: r.id,
      actorId: r.actorId,
      action: r.action,
      targetId: r.targetId ?? null,
      details: r.details ?? {},
      createdAt: r.createdAt,
    }));

    // The failed provider call itself: found on the Job's own step
    // record, not the audit trail -- the audit write for a step happens
    // BEFORE that step runs (M14's own gate design), so it never carries
    // that step's outcome. Joining the Job row is what makes "the
    // provider call" nameable, not just "a step started."
    const jobs = await (prisma as any).job.findMany({ where: { correlationId } });
    let failedAt: FailedStepInfo | null = null;
    for (const job of jobs) {
      const steps = (job.steps as any[]) ?? [];
      const failedStep = steps.find((s) => s.status === "FAILED");
      if (failedStep) {
        failedAt = { jobId: job.id, resourceId: job.resourceId ?? null, stepName: failedStep.name, error: failedStep.error ?? "unknown error" };
        break;
      }
    }

    const traceIdEvent = events.find((e) => typeof (e.details as any)?.traceId === "string");
    const traceId = traceIdEvent ? ((traceIdEvent.details as any).traceId as string) : null;

    const grafanaBase = process.env.GRAFANA_BASE_URL;
    const grafanaUrl = grafanaBase ? `${grafanaBase.replace(/\/$/, "")}/explore?correlationId=${encodeURIComponent(correlationId)}` : null;

    const tempoBase = process.env.TEMPO_BASE_URL ?? grafanaBase;
    const traceUrl = tempoBase && traceId ? `${tempoBase.replace(/\/$/, "")}/explore?traceId=${encodeURIComponent(traceId)}` : null;

    return { correlationId, events, failedAt, grafanaUrl, traceUrl };
  }
}
