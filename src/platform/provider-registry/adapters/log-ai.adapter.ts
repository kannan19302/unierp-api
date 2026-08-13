/**
 * M39 — reference adapter #2 for `llm.complete`: a log/echo-backed
 * adapter. Records what would have been completed instead of calling a
 * vendor, and echoes the prompt back as the completion — a standard,
 * legitimate pattern for local development and CI (the console backend
 * of every LLM SDK), NOT a fake standing in for a vendor. It is
 * genuinely useful on its own and proves the abstraction with a second,
 * structurally different implementation: no network I/O, a different
 * failure mode (this adapter can never be network-unhealthy), and a
 * deterministic completion — exactly what an evaluation suite wants to
 * run against in CI.
 */
import type { CapabilityAdapter, ExecutionResult, HealthProbeResult } from "../adapter-contract";
import type { DiscoveredCapability } from "../provider-adapter.interface";

export interface LoggedAiCompletion {
  prompt: string;
  model: string | null;
  completion: string;
  tokensUsed: number;
  loggedAt: Date;
}

export class LogAiAdapter implements CapabilityAdapter {
  readonly capabilityId = "llm.complete";
  readonly completed: LoggedAiCompletion[] = [];

  constructor(readonly providerId: string) {}

  async discover(): Promise<DiscoveredCapability[]> {
    return [{ capabilityId: this.capabilityId, detail: { engine: "log", environment: "dev/test" } }];
  }

  async checkHealth(): Promise<HealthProbeResult> {
    return { healthy: true, latencyMs: 0 };
  }

  async execute(input: Record<string, unknown>): Promise<ExecutionResult> {
    const prompt = input.prompt as string | undefined;
    const model = (input.model as string | undefined) ?? null;
    if (!prompt) {
      return { success: false, error: `llm.complete requires prompt — got ${JSON.stringify(Object.keys(input))}` };
    }
    const completion = `echo: ${prompt}`;
    const tokensUsed = prompt.length;
    this.completed.push({ prompt, model, completion, tokensUsed, loggedAt: new Date() });
    return { success: true, output: { completion, tokensUsed } };
  }
}