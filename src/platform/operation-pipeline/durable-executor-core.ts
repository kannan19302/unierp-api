/**
 * M12 — the durable execution algorithm itself, with no NestJS dependency.
 * `DurableExecutorService` is a thin `@Injectable()` wrapper around this
 * class for use inside the application; this file also runs standalone in
 * `kill-and-resume.worker.ts`, spawned as a real child process for the
 * exit criterion's "proven by killing it" requirement — Node's native
 * TypeScript support can run this file directly because it has no
 * decorators to transform, only erasable type annotations.
 */
import type { JobState, JobStateStore, StepRecord } from "./job-state-store";

export interface JobStepDefinition {
  name: string;
  run: () => Promise<unknown>;
  compensate?: () => Promise<void>;
}

export interface StepAuditInfo {
  jobId: string;
  planId: string | null;
  resourceId: string | null;
  stepIndex: number;
  stepName: string;
}

/**
 * M14: called immediately BEFORE a step's `run()`, and awaited. If it
 * throws, `run()` is never called — this is what "no pipeline stage can
 * execute without an audit record" means as code rather than a policy: a
 * broken audit writer does not merely fail to log, it stops execution,
 * because the two are the same call in the same order every time.
 */
export type AuditWriter = (info: StepAuditInfo) => Promise<void>;

export class DurableExecutorCore {
  private readonly store: JobStateStore;
  private readonly auditWriter: AuditWriter;

  constructor(store: JobStateStore, auditWriter: AuditWriter) {
    this.store = store;
    this.auditWriter = auditWriter;
  }

  async startJob(
    jobId: string,
    planId: string | null,
    resourceId: string | null,
    definitions: JobStepDefinition[],
  ): Promise<JobState> {
    const stepRecords: StepRecord[] = definitions.map((d) => ({ name: d.name, status: "PENDING" }));
    await this.store.createJob(jobId, planId, resourceId, stepRecords);
    return this.run(jobId, definitions);
  }

  async resumeJob(jobId: string, definitions: JobStepDefinition[]): Promise<JobState> {
    const existing = await this.store.loadJob(jobId);
    if (!existing) {
      throw new Error(`No job "${jobId}" to resume — it was never created`);
    }
    if (existing.status === "DONE" || existing.status === "HALTED" || existing.status === "COMPENSATED") {
      return existing;
    }
    return this.run(jobId, definitions);
  }

  private async run(jobId: string, definitions: JobStepDefinition[]): Promise<JobState> {
    const job = await this.store.loadJob(jobId);
    if (!job) throw new Error(`Job "${jobId}" not found`);

    job.status = "RUNNING";
    await this.store.saveState(job);

    for (let i = job.stepIndex; i < definitions.length; i++) {
      const def = definitions[i];
      const priorStep = job.steps[i];
      if (!def || !priorStep) {
        throw new Error(`Job "${jobId}" step ${i} definition/record mismatch — steps and definitions must be the same length and order`);
      }
      job.steps[i] = { name: priorStep.name, status: "RUNNING" };

      let result: unknown;
      try {
        // The gate: this call happens BEFORE def.run(), not after, and
        // def.run() is textually unreachable from this catch block if the
        // audit write throws — there is no path from "audit failed" to
        // "the step ran anyway."
        await this.auditWriter({
          jobId,
          planId: job.planId,
          resourceId: job.resourceId,
          stepIndex: i,
          stepName: def.name,
        });
        result = await def.run();
      } catch (err) {
        job.steps[i] = {
          name: priorStep.name,
          status: "FAILED",
          error: err instanceof Error ? err.message : String(err),
        };
        await this.store.saveState(job);
        await this.compensateAndFinish(job, definitions, i);
        return job;
      }

      job.steps[i] = { name: priorStep.name, status: "DONE", result };
      job.stepIndex = i + 1; // the durable commit point this whole guarantee rests on
      await this.store.saveState(job);
    }

    job.status = "DONE";
    await this.store.saveState(job);
    return job;
  }

  private async compensateAndFinish(
    job: JobState,
    definitions: JobStepDefinition[],
    failedIndex: number,
  ): Promise<void> {
    let anyCompensated = false;
    let anyCompensationFailed = false;

    for (let j = failedIndex - 1; j >= 0; j--) {
      const def = definitions[j];
      const step = job.steps[j];
      if (!def || !step || step.status !== "DONE" || !def.compensate) continue;
      try {
        await def.compensate();
        job.steps[j] = { name: step.name, status: "COMPENSATED", result: step.result };
        anyCompensated = true;
      } catch (err) {
        anyCompensationFailed = true;
        job.steps[j] = {
          name: step.name,
          status: "FAILED",
          result: step.result,
          error: `compensation failed: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    }

    job.status = anyCompensated && !anyCompensationFailed ? "COMPENSATED" : "HALTED";
    await this.store.saveState(job);
  }
}
