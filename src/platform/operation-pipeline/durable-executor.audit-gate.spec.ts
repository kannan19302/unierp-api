/**
 * M14 exit criterion (audit-gate half): "No pipeline stage can execute
 * without an audit record — asserted by a test that removes the audit
 * writer and expects failure."
 *
 * This is that test. It removes the audit writer literally — passes one
 * that always throws, standing in for "the audit spine is down" — and
 * asserts two things together: the job fails, AND the step's own `run()`
 * was never called. The second assertion is what distinguishes "audit is a
 * hard gate" from "audit happens to run first, but the step runs anyway
 * even if audit fails."
 */
import { describe, it, expect } from "vitest";
import { DurableExecutorCore, type JobStepDefinition } from "./durable-executor-core";
import type { JobState, JobStateStore, StepRecord } from "./job-state-store";

class InMemoryJobStateStore implements JobStateStore {
  private jobs = new Map<string, JobState>();

  async createJob(id: string, planId: string | null, resourceId: string | null, steps: StepRecord[]): Promise<JobState> {
    const job: JobState = { id, planId, resourceId, status: "PENDING", stepIndex: 0, steps };
    this.jobs.set(id, job);
    return job;
  }
  async loadJob(id: string): Promise<JobState | null> {
    return this.jobs.get(id) ?? null;
  }
  async saveState(job: JobState): Promise<void> {
    this.jobs.set(job.id, { ...job, steps: [...job.steps] });
  }
}

describe("M14 · no pipeline stage can execute without an audit record", () => {
  it("removing the audit writer (making it always fail) halts the job before the step ever runs", async () => {
    const store = new InMemoryJobStateStore();
    let stepActuallyRan = false;

    // The audit writer removed / broken — standing in for "C03's audit
    // spine is unreachable."
    const brokenAuditWriter = async () => {
      throw new Error("audit spine unreachable");
    };

    const executor = new DurableExecutorCore(store, brokenAuditWriter);

    const steps: JobStepDefinition[] = [
      {
        name: "provision-resource",
        run: async () => {
          stepActuallyRan = true; // must NEVER be reached
          return "provisioned";
        },
      },
    ];

    const job = await executor.startJob("audit-gate-job", null, "res-1", steps);

    expect(stepActuallyRan, "the step's own logic must never run when the audit write fails").toBe(false);
    expect(job.steps[0].status).toBe("FAILED");
    expect(job.steps[0].error).toContain("audit spine unreachable");
    // No compensator was registered, so this halts — the correct outcome
    // for an audit failure exactly as for any other step failure.
    expect(job.status).toBe("HALTED");
  });

  it("a healthy audit writer lets the step run normally — the gate is a real gate, not a permanent lock", async () => {
    const store = new InMemoryJobStateStore();
    const auditCalls: string[] = [];
    let stepRan = false;

    const executor = new DurableExecutorCore(store, async (info) => {
      auditCalls.push(info.stepName);
    });

    const steps: JobStepDefinition[] = [
      {
        name: "provision-resource",
        run: async () => {
          stepRan = true;
          return "provisioned";
        },
      },
    ];

    const job = await executor.startJob("audit-gate-job-2", null, "res-2", steps);

    expect(auditCalls).toEqual(["provision-resource"]);
    expect(stepRan).toBe(true);
    expect(job.status).toBe("DONE");
  });

  it("the audit write happens for EVERY step, not only the first — removing it mid-job halts at the exact step it broke on", async () => {
    const store = new InMemoryJobStateStore();
    let auditCallCount = 0;
    const ran: string[] = [];

    const executor = new DurableExecutorCore(store, async () => {
      auditCallCount++;
      if (auditCallCount === 2) {
        throw new Error("audit spine failed on the second call");
      }
    });

    const steps: JobStepDefinition[] = [
      { name: "step-1", run: async () => { ran.push("step-1"); return "ok"; } },
      { name: "step-2", run: async () => { ran.push("step-2"); return "ok"; } }, // must not run
      { name: "step-3", run: async () => { ran.push("step-3"); return "ok"; } }, // must not run
    ];

    const job = await executor.startJob("audit-gate-job-3", null, "res-3", steps);

    expect(ran, "only step 1 should have run — its audit call succeeded before step 2's audit call failed").toEqual([
      "step-1",
    ]);
    expect(job.steps[0].status).toBe("DONE");
    expect(job.steps[1].status).toBe("FAILED");
    expect(job.steps[1].error).toContain("second call");
    expect(job.steps[2].status).toBe("PENDING"); // never reached at all
  });
});
