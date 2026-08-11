/**
 * M12 exit criterion (durability half): "An executor killed mid-plan
 * resumes without repeating a completed step, proven by killing it."
 *
 * This spawns kill-and-resume.worker.ts as a REAL, separate OS process,
 * waits until it signals that step 2 has begun (after step 1 has already
 * committed durably to disk), sends it a real kill signal, waits for the
 * process to actually die, then spawns a SECOND process to resume from the
 * same durable file. The assertion that matters: step 1's log line appears
 * exactly once across both process runs — not simulated by calling a
 * function twice in the same process, which would prove nothing about
 * surviving a real process death.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const WORKER = join(__dirname, "kill-and-resume.worker.ts");

function tempFile(name: string): string {
  return join(tmpdir(), `m12-kill-proof-${Date.now()}-${name}`);
}

async function waitForFile(path: string, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (!existsSync(path)) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`Timed out waiting for ${path} to appear`);
    }
    await new Promise((r) => setTimeout(r, 50));
  }
}

async function waitForExit(child: import("node:child_process").ChildProcess): Promise<void> {
  await new Promise<void>((resolve) => child.once("exit", () => resolve()));
}

describe("M12 · durable execution — proven by killing a real process", () => {
  let jobFile: string;
  let logFile: string;
  let markerFile: string;

  beforeEach(() => {
    jobFile = tempFile("job.json");
    logFile = tempFile("log.txt");
    markerFile = tempFile("started.marker");
    writeFileSync(logFile, "", "utf8");
  });

  afterEach(() => {
    for (const f of [jobFile, logFile, markerFile]) {
      if (existsSync(f)) rmSync(f, { force: true });
    }
  });

  it(
    "killing the process mid-step-2 leaves step 1 durably DONE; resuming in a new process does not re-run it",
    async () => {
      const startProc = spawn(process.execPath, [WORKER, jobFile, logFile, markerFile, "start"], {
        stdio: "ignore",
      });

      // Wait until the child has begun step 2 — proves the kill lands
      // strictly after step 1's durable write, strictly during step 2.
      await waitForFile(markerFile, 10_000);

      // A real kill, not a graceful shutdown request the process could
      // catch and use to flush extra state — SIGKILL is unconditional.
      startProc.kill("SIGKILL");
      await waitForExit(startProc);

      const jobAfterKill = JSON.parse(readFileSync(jobFile, "utf8"));
      expect(jobAfterKill.stepIndex, "step 1 must be durably committed before the kill").toBe(1);
      expect(jobAfterKill.steps[0].status).toBe("DONE");
      expect(jobAfterKill.status, "must not be DONE — the process died mid-flight, this must be visible").not.toBe(
        "DONE",
      );

      const logAfterKill = readFileSync(logFile, "utf8");
      expect(logAfterKill).toContain("step-1-fast:ran");
      expect(logAfterKill).toContain("step-2-slow:started");
      expect(logAfterKill, "step 2 must not have reached completion — that's the whole point of killing it here").not.toContain(
        "step-2-slow:completed",
      );

      // A SECOND, independent process resumes from the same durable file.
      const resumeProc = spawn(process.execPath, [WORKER, jobFile, logFile, markerFile, "resume"], {
        stdio: "ignore",
      });
      await waitForExit(resumeProc);

      const jobAfterResume = JSON.parse(readFileSync(jobFile, "utf8"));
      expect(jobAfterResume.status).toBe("DONE");
      expect(jobAfterResume.steps.map((s: any) => s.status)).toEqual(["DONE", "DONE"]);

      const logAfterResume = readFileSync(logFile, "utf8");
      const step1Occurrences = logAfterResume.split("step-1-fast:ran").length - 1;
      expect(step1Occurrences, "step 1 ran in the FIRST process and must not run again in the resumed one").toBe(1);
      expect(logAfterResume).toContain("step-2-slow:completed");
    },
    20_000,
  );
});
