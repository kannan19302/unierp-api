import { Injectable } from "@nestjs/common";
import type { CapabilityAdapter, ExecutionResult } from "../provider-registry/adapter-contract";
import type { Plan } from "./planning.service";

/**
 * M09's third assertion, made structural rather than a convention someone
 * has to remember: "no operation reaches a provider without a plan."
 *
 * This is a minimal stand-in for M12's real durable executor — the same
 * "explicitly superseded, not extended" relationship M03's ProviderAdapter
 * stub has to M05's CapabilityAdapter. Its only job here is to prove the
 * TYPE-LEVEL guarantee: the only method that calls `adapter.execute()`
 * takes a `Plan` as its first parameter, so calling an adapter directly —
 * bypassing planning — requires bypassing this service entirely, which is
 * exactly what the exit criterion's dry-run assertion (zero provider calls
 * from `createPlan`/`dryRun`) proves does not happen on the planning path.
 */
@Injectable()
export class PlanGatedExecutor {
  async execute(plan: Plan, adapter: CapabilityAdapter, input: Record<string, unknown>): Promise<ExecutionResult> {
    return adapter.execute(input);
  }
}
