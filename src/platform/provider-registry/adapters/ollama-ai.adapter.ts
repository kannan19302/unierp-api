/**
 * M39 — reference adapter #1 for `llm.complete`: Ollama-backed.
 *
 * Wraps the same `/api/generate` endpoint the platform's single
 * hard-coded Ollama transport (`common/integrations/ollama-client.ts`)
 * already calls, configured per-provider via env. This is the reference
 * pair's "real vendor" half — a provider bound to `llm.complete` with
 * this adapter genuinely executes a completion, and the AI gateway routes
 * to it exactly as it routes to any other AI provider.
 */
import type { CapabilityAdapter, ExecutionResult, HealthProbeResult } from "../adapter-contract";
import type { DiscoveredCapability } from "../provider-adapter.interface";

export interface OllamaAiConfig {
  baseUrl: string;
  model: string;
}

export class OllamaAiAdapter implements CapabilityAdapter {
  readonly capabilityId = "llm.complete";

  constructor(
    readonly providerId: string,
    private readonly config: OllamaAiConfig,
  ) {}

  async discover(): Promise<DiscoveredCapability[]> {
    return [
      {
        capabilityId: this.capabilityId,
        detail: { engine: "ollama", baseUrl: this.config.baseUrl, defaultModel: this.config.model },
      },
    ];
  }

  async checkHealth(): Promise<HealthProbeResult> {
    const start = Date.now();
    try {
      const res = await fetch(`${this.config.baseUrl}/api/tags`, {
        method: "GET",
        signal: AbortSignal.timeout(5000),
      });
      return res.ok
        ? { healthy: true, latencyMs: Date.now() - start }
        : { healthy: false, error: `ollama /api/tags returned ${res.status}` };
    } catch (err) {
      return { healthy: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  async execute(input: Record<string, unknown>): Promise<ExecutionResult> {
    const prompt = input.prompt as string | undefined;
    const model = (input.model as string | undefined) ?? this.config.model;
    const maxTokens = input.maxTokens as number | undefined;
    if (!prompt) {
      return { success: false, error: `llm.complete requires prompt — got ${JSON.stringify(Object.keys(input))}` };
    }
    try {
      const res = await fetch(`${this.config.baseUrl}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, prompt, stream: false, options: maxTokens ? { num_predict: maxTokens } : undefined }),
        signal: AbortSignal.timeout(60_000),
      });
      if (!res.ok) {
        return { success: false, error: `ollama /api/generate returned ${res.status}` };
      }
      const data = (await res.json()) as { response?: string; eval_count?: number };
      return {
        success: true,
        output: {
          completion: data.response ?? "",
          tokensUsed: data.eval_count ?? 0,
        },
      };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}