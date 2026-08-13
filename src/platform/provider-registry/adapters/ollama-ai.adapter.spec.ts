/**
 * Conformance of the Ollama-backed `llm.complete` adapter against M05's
 * suite. No live Ollama in this sandbox: fetch is mocked to behave like
 * `/api/generate` (a deterministic echo, eval_count = prompt length) so
 * execute()'s real wiring — input validation, request shape, output
 * mapping — is exercised rather than bypassed.
 */
import { vi } from "vitest";

const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
  if (String(url).endsWith("/api/tags")) {
    return { ok: true, status: 200 };
  }
  if (String(url).endsWith("/api/generate")) {
    const body = JSON.parse(String(init?.body));
    const prompt = String(body.prompt ?? "");
    return {
      ok: true,
      status: 200,
      json: async () => ({ response: `ollama: ${prompt}`, eval_count: prompt.length }),
    };
  }
  return { ok: false, status: 404 };
});

vi.stubGlobal("fetch", fetchMock);

import { runAdapterConformanceSuite } from "../adapter-conformance-suite";
import { OllamaAiAdapter } from "./ollama-ai.adapter";

runAdapterConformanceSuite(
  "OllamaAiAdapter (fetch mocked to /api/generate)",
  () =>
    new OllamaAiAdapter("ollama-ai-1", {
      baseUrl: "http://localhost:11434",
      model: "llama3.2",
    }),
  {
    validInput: { prompt: "Explain the exit criterion" },
    invalidInput: { model: "no prompt here" },
  },
);