/**
 * M12 exit criterion (compensation/halt half): "A failed step compensates
 * or halts — never leaves a half-provisioned resource unrecorded."
 *
 * The kill-and-resume half of the exit criterion is proven separately in
 * durable-executor.kill-and-resume.spec.ts, which spawns and SIGKILLs a
 * real child process — a fake-timer or in-memory "simulated crash" would
 * not cross a real process boundary, and the exit criterion specifically
 * says "proven by killing it."
 */
import { describe, it, expect, beforeEach } from "vitest";
import { DurableExecutorCore, type JobStepDefinition } from "./durable-executor-core";
import type { JobState, JobStateStore, StepRecord } from "./job-state-store";

/** A plain in-memory store — sufficient for this file's purpose, which is
 *  the compensate/halt DECISION LOGIC, not durability across a process
 *  boundary (that is what the kill-and-resume spec exists for). */
class InMemoryJobStateStore implements JobStateStore {
  private jobs = new Map<string, JobState>();
  saveCallCount = 0;

  async createJob(id: string, planId: string | null, resourceId: string | null, steps: StepRecord[]): Promise<JobState> {
    const job: JobState = { id, planId, resourceId, status: "PENDING", stepIndex: 0, steps };
    this.jobs.set(id, job);
    return job;
  }
  async loadJob(id: string): Promise<JobState | null> {
    return this.jobs.get(id) ?? null;
  }
  async saveState(job: JobState): Promise<void> {
    this.saveCallCount++;
    this.jobs.set(job.id, { ...job, steps: [...job.steps] });
  }
}

describe("M12 · durable execution — compensation and halt", () => {
  let store: InMemoryJobStateStore;
  let executor: DurableExecutorCore;

  beforeEach(() => {
    store = new InMemoryJobStateStore();
    // A working audit writer — M14's own "audit writer removed" proof
    // lives in durable-executor.audit-gate.spec.ts, deliberately separate
    // from this file so these compensate/halt cases stay about that logic
    // alone.
    executor = new DurableExecutorCore(store, async () => {});
  });

  it("a job with no failures completes DONE with every step DONE", async () => {
    const steps: JobStepDefinition[] = [
      { name: "a", run: async () => "ok-a" },
      { name: "b", run: async () => "ok-b" },
    ];
    const job = await executor.startJob("job-1", null, null, steps);
    expect(job.status).toBe("DONE");
    expect(job.steps.map((s) => s.status)).toEqual(["DONE", "DONE"]);
    expect(job.stepIndex).toBe(2);
  });

  it("a failed step with compensable prior steps compensates them in reverse order — never leaves the resource unrecorded", async () => {
    const compensated: string[] = [];
    const steps: JobStepDefinition[] = [
      { name: "allocate-ip", run: async () => "ip-1", compensate: async () => { compensated.push("allocate-ip"); } },
      { name: "create-dns-record", run: async () => "record-1", compensate: async () => { compensated.push("create-dns-record"); } },
      { name: "issue-certificate", run: async () => { throw new Error("CA rejected the request"); } },
    ];

    const job = await executor.startJob("job-2", "plan-x", "res-1", steps);

    expect(job.status).toBe("COMPENSATED");
    expect(compensated).toEqual(["create-dns-record", "allocate-ip"]); // reverse order
    expect(job.steps[0].status).toBe("COMPENSATED");
    expect(job.steps[1].status).toBe("COMPENSATED");
    expect(job.steps[2].status).toBe("FAILED");
    expect(job.steps[2].error).toContain("CA rejected");
  });

  it("a failed step with NO compensable prior steps halts — recorded, not silently vanished", async () => {
    const steps: JobStepDefinition[] = [
      { name: "irreversible-provision", run: async () => "done" }, // no compensate
      { name: "second-step", run: async () => { throw new Error("network partition"); } },
    ];

    const job = await executor.startJob("job-3", null, "res-2", steps);

    expect(job.status).toBe("HALTED");
    expect(job.steps[0].status).toBe("DONE"); // still recorded as done — not erased
    expect(job.steps[1].status).toBe("FAILED");
  });

  it("a compensation that itself fails is recorded, not swallowed — the job still halts rather than falsely reporting recovery", async () => {
    const steps: JobStepDefinition[] = [
      {
        name: "allocate-budget",
        run: async () => "ok",
        compensate: async () => {
          throw new Error("refund API unreachable");
        },
      },
      { name: "provision-vm", run: async () => { throw new Error("quota exceeded"); } },
    ];

    const job = await executor.startJob("job-4", null, "res-3", steps);

    expect(job.status, "compensation failing must not report COMPENSATED — that would be a false recovery claim").toBe(
      "HALTED",
    );
    expect(job.steps[0].status).toBe("FAILED");
    expect(job.steps[0].error).toContain("refund API unreachable");
  });

  it("resuming a job whose failure already halted it is a no-op — does not re-attempt", async () => {
    const attempts: string[] = [];
    const steps: JobStepDefinition[] = [
      { name: "step-a", run: async () => { attempts.push("a"); return "ok"; } },
      { name: "step-b", run: async () => { attempts.push("b"); throw new Error("boom"); } },
    ];
    await executor.startJob("job-5", null, null, steps);
    expect(attempts).toEqual(["a", "b"]);

    const resumed = await executor.resumeJob("job-5", steps);
    expect(resumed.status).toBe("HALTED");
    expect(attempts, "a terminal job must not be re-run").toEqual(["a", "b"]);
  });
});
