/**
 * M12's kill-and-resume proof worker. Run directly by Node (no build step —
 * see durable-executor-core.ts's own comment on why this file has no
 * decorators or parameter-property shorthand: both require a real
 * TypeScript transform, and Node's native --experimental-strip-types-style
 * execution only erases type annotations).
 *
 * Args: node kill-and-resume.worker.ts <jobFile> <logFile> <startedMarkerFile> <mode>
 *   mode = "start"  -> create the job and run it (step 1 fast, step 2 slow —
 *                       slow enough for the parent test to SIGKILL mid-step-2)
 *   mode = "resume" -> load the existing job and resume it
 */
import { appendFileSync, writeFileSync } from "node:fs";
import { DurableExecutorCore, type JobStepDefinition } from "./durable-executor-core.ts";
import { FileJobStateStore } from "./file-job-state-store.ts";

const [jobFile, logFile, startedMarkerFile, mode] = process.argv.slice(2);
if (!jobFile || !logFile || !startedMarkerFile || !mode) {
  throw new Error("usage: node kill-and-resume.worker.ts <jobFile> <logFile> <startedMarkerFile> <start|resume>");
}

function log(line: string): void {
  appendFileSync(logFile, line + "\n", "utf8");
}

const steps: JobStepDefinition[] = [
  {
    name: "step-1-fast",
    run: async () => {
      log("step-1-fast:ran");
      return "step-1-result";
    },
  },
  {
    name: "step-2-slow",
    run: async () => {
      log("step-2-slow:started");
      // Signal the parent that step 2 has begun — this is the parent's cue
      // to SIGKILL, guaranteeing the kill lands strictly after step 1's
      // durable commit and strictly during step 2's execution.
      writeFileSync(startedMarkerFile, "started", "utf8");
      await new Promise((r) => setTimeout(r, 5000)); // long enough to be killed mid-flight
      log("step-2-slow:completed"); // only reached if NOT killed
      return "step-2-result";
    },
  },
];

const store = new FileJobStateStore(jobFile);
// M14: not the real ControlPlaneAuditService (no NestJS, no live DB
// reachable standalone) — logging to the same durable file this proof
// already uses is enough to exercise the gate rather than skip it, which
// is all this worker needs; the real app wires the real audit spine in
// DurableExecutorService.
const executor = new DurableExecutorCore(store, async (info) => {
  log(`audit:${info.stepName}`);
});

(async () => {
  if (mode === "start") {
    await executor.startJob("kill-proof-job", null, null, steps);
  } else if (mode === "resume") {
    await executor.resumeJob("kill-proof-job", steps);
  } else {
    throw new Error(`unknown mode "${mode}"`);
  }
})();
