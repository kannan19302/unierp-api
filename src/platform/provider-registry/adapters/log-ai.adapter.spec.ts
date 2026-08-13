/**
 * Conformance of the log/echo-backed `llm.complete` adapter against M05's
 * suite. Deterministic and network-free, so every conformance assertion
 * runs without any mocking.
 */
import { runAdapterConformanceSuite } from "../adapter-conformance-suite";
import { LogAiAdapter } from "./log-ai.adapter";

runAdapterConformanceSuite(
  "LogAiAdapter (echo backend)",
  () => new LogAiAdapter("log-ai-1"),
  {
    validInput: { prompt: "Summarize the meeting" },
    invalidInput: { model: "no prompt here" },
  },
);