import { readFileSync, writeFileSync, existsSync } from "node:fs";
import type { JobState, JobStateStore, StepRecord } from "./job-state-store";

/**
 * M12's kill-and-resume proof needs state that survives a real SIGKILL of
 * the process holding it, and no live database is reachable in this
 * environment (no DATABASE_URL — see D050 and the Track M schema
 * commits' own stated limits). A synchronous file write IS durable across
 * a process boundary on a real filesystem, which is exactly the property
 * this proof needs and an in-memory store cannot provide. Never used in
 * the running application — `PrismaJobStateStore` is production; this
 * exists solely so the kill-and-resume spec can exercise a real process
 * death against something that actually persists past it.
 */
export class FileJobStateStore implements JobStateStore {
  private readonly filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  async createJob(id: string, planId: string | null, resourceId: string | null, steps: StepRecord[]): Promise<JobState> {
    const job: JobState = { id, planId, resourceId, status: "PENDING", stepIndex: 0, steps };
    this.writeSync(job);
    return job;
  }

  async loadJob(id: string): Promise<JobState | null> {
    if (!existsSync(this.filePath)) return null;
    const job = JSON.parse(readFileSync(this.filePath, "utf8")) as JobState;
    return job.id === id ? job : null;
  }

  async saveState(job: JobState): Promise<void> {
    this.writeSync(job);
  }

  /** Synchronous, deliberately: the durability guarantee this proof exists
   *  for depends on the write having actually landed on disk before the
   *  caller (the executor) proceeds — an async write racing a SIGKILL would
   *  make the proof meaningless. */
  private writeSync(job: JobState): void {
    writeFileSync(this.filePath, JSON.stringify(job), "utf8");
  }
}
