/**
 * M12 — the durable state a Job's execution reads and writes. The DURABILITY
 * guarantee ("resumes without repeating a completed step") is a property of
 * this interface's contract, not of any one implementation: whatever writes
 * `state` must have already committed by the time `saveState` resolves, so a
 * process death immediately after a step completes still leaves the
 * completed step recorded. `PrismaJobStateStore` is the production
 * implementation (Postgres); a file-backed store is used only by this
 * phase's own kill-and-resume proof, where a real OS process boundary
 * matters and a live database is not reachable in this environment — the
 * algorithm under test is identical either way, only the disk it commits to
 * differs.
 */
export interface StepRecord {
  name: string;
  status: "PENDING" | "RUNNING" | "DONE" | "FAILED" | "COMPENSATED";
  result?: unknown;
  error?: string;
}

export interface JobState {
  id: string;
  planId: string | null;
  resourceId: string | null;
  /** M34 — threaded from the console request that triggered this job, so
   *  every pipeline-step audit record can carry it and one query
   *  correlates the click to the provider call. */
  correlationId?: string | null;
  status: "PENDING" | "RUNNING" | "DONE" | "FAILED" | "HALTED" | "COMPENSATED";
  stepIndex: number;
  steps: StepRecord[];
}

export interface JobStateStore {
  createJob(
    id: string,
    planId: string | null,
    resourceId: string | null,
    steps: StepRecord[],
    correlationId?: string | null,
  ): Promise<JobState>;
  loadJob(id: string): Promise<JobState | null>;
  saveState(job: JobState): Promise<void>;
}
