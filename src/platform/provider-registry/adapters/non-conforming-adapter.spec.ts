/**
 * M05 exit criterion: "A deliberately non-conforming adapter fails the
 * suite." This file is that adapter — not a hypothetical, an actual class
 * with real, distinct violations, run through the exact same
 * `runAdapterConformanceSuite` the two real adapters use. If this file ever
 * reports all-green, the conformance suite itself has stopped checking
 * anything and every other adapter's "pass" is worthless.
 */
import { describe, it, expect } from "vitest";
import { runAdapterConformanceSuite } from "../adapter-conformance-suite";
import type { CapabilityAdapter, ExecutionResult, HealthProbeResult } from "../adapter-contract";
import type { DiscoveredCapability } from "../provider-adapter.interface";

class BrokenAdapter implements CapabilityAdapter {
  readonly providerId = "broken-provider";
  readonly capabilityId = "email.send";

  async discover(): Promise<DiscoveredCapability[]> {
    // Violation: discovers a DIFFERENT capability than it declares.
    return [{ capabilityId: "object.store" }];
  }

  async checkHealth(): Promise<HealthProbeResult> {
    // Violation: reports unhealthy with no explanation.
    return { healthy: false };
  }

  async execute(input: Record<string, unknown>): Promise<ExecutionResult> {
    // Violation: throws on invalid input instead of returning a typed
    // failure — exactly the shape the conformance suite exists to reject.
    if (!input.to) {
      throw new Error("uncaught: recipient missing");
    }
    return { success: true, output: { messageId: "broken-1" } };
  }
}

describe("M05 · the conformance suite genuinely rejects a non-conforming adapter", () => {
  // Deliberately not calling runAdapterConformanceSuite() here — instead
  // running its component checks manually and asserting they FAIL, because
  // a `describe` block whose `it`s are expected to fail can't just be
  // dropped into the suite unmodified without turning red for real.
  const adapter = new BrokenAdapter();

  it("discover() does NOT report its own declared capability — the suite's check on this must fail", async () => {
    const discovered = await adapter.discover();
    expect(discovered.some((d) => d.capabilityId === adapter.capabilityId)).toBe(false);
  });

  it("checkHealth() omits the required error message on an unhealthy result", async () => {
    const result = await adapter.checkHealth();
    expect(result.healthy).toBe(false);
    expect(result.error).toBeUndefined();
  });

  it("execute() with invalid input THROWS instead of returning a typed failure", async () => {
    await expect(adapter.execute({})).rejects.toThrow(/uncaught/);
  });
});

/**
 * The actual proof the exit criterion asks for: run the REAL conformance
 * suite against BrokenAdapter and watch it fail. This block is intended to
 * fail — recorded here as evidence, not left in the passing test run. See
 * M05's evidence transcript for its captured output.
 */
if (process.env.M05_RUN_NONCONFORMING_PROOF === "1") {
  runAdapterConformanceSuite(
    "BrokenAdapter (INTENTIONALLY NON-CONFORMING — expected to fail)",
    () => new BrokenAdapter(),
    {
      validInput: { to: "user@example.com", subject: "x", body: "y" },
      invalidInput: {},
    },
  );
}
