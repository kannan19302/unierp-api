/**
 * M05 — the real provider adapter contract, superseding M03's minimal stub
 * (`provider-adapter.interface.ts`, which stated up front that M05 would
 * replace it rather than extend it).
 *
 * Every capability's provider implements this. `discover()` is M03's;
 * `checkHealth()` feeds M04's `recordHealthCheck`; `execute()` is the
 * operation itself — the thing M06's router ultimately calls.
 */
import type { DiscoveredCapability } from "./provider-adapter.interface";

export interface HealthProbeResult {
  healthy: boolean;
  latencyMs?: number;
  error?: string;
}

export interface ExecutionResult {
  success: boolean;
  output?: Record<string, unknown>;
  error?: string;
}

export interface CapabilityAdapter {
  readonly providerId: string;
  readonly capabilityId: string;

  discover(): Promise<DiscoveredCapability[]>;
  checkHealth(): Promise<HealthProbeResult>;
  execute(input: Record<string, unknown>): Promise<ExecutionResult>;
}
