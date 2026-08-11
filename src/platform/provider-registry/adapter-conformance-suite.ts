/**
 * M05 — the conformance suite. Call `runAdapterConformanceSuite(...)` from
 * any adapter's own `.spec.ts` file; it generates the same battery of
 * `it()` blocks against whatever adapter factory is passed in. This is what
 * "adding a third provider requires no change outside its own adapter"
 * means concretely: the third adapter's spec file calls this same function
 * with its own factory, and nothing here changes.
 */
import { describe, it, expect } from "vitest";
import type { CapabilityAdapter } from "./adapter-contract";

export interface ConformanceFixtures {
  /** Input execute() should accept and succeed on. */
  validInput: Record<string, unknown>;
  /** Input execute() should reject — a well-behaved adapter reports this via
   *  ExecutionResult.success === false, never an uncaught throw. */
  invalidInput: Record<string, unknown>;
}

export function runAdapterConformanceSuite(
  label: string,
  makeAdapter: () => CapabilityAdapter,
  fixtures: ConformanceFixtures,
): void {
  describe(`Adapter conformance: ${label}`, () => {
    it("declares a non-empty providerId and capabilityId", () => {
      const adapter = makeAdapter();
      expect(adapter.providerId, "providerId must not be empty").toBeTruthy();
      expect(adapter.capabilityId, "capabilityId must not be empty").toBeTruthy();
    });

    it("discover() returns an array whose entries include this adapter's own capability", async () => {
      const adapter = makeAdapter();
      const discovered = await adapter.discover();
      expect(Array.isArray(discovered), "discover() must return an array").toBe(true);
      expect(
        discovered.some((d) => d.capabilityId === adapter.capabilityId),
        "discover() must report the adapter's own declared capability among what it found — " +
          "an adapter that discovers nothing matching its own claim is not conforming",
      ).toBe(true);
    });

    it("checkHealth() returns a typed result with a boolean healthy field", async () => {
      const adapter = makeAdapter();
      const result = await adapter.checkHealth();
      expect(typeof result.healthy, "healthy must be a boolean").toBe("boolean");
      if (!result.healthy) {
        expect(
          result.error,
          "an unhealthy result must explain why — an operator cannot act on a bare false",
        ).toBeTruthy();
      }
    });

    it("execute() with valid input reports success with an output object", async () => {
      const adapter = makeAdapter();
      const result = await adapter.execute(fixtures.validInput);
      expect(result.success, `expected success, got error: ${result.error}`).toBe(true);
      expect(result.output, "a successful execution must report an output object").toBeTruthy();
    });

    it("execute() with invalid input reports failure via the typed result — never an uncaught throw", async () => {
      const adapter = makeAdapter();
      let thrown: unknown;
      let result: Awaited<ReturnType<CapabilityAdapter["execute"]>> | undefined;
      try {
        result = await adapter.execute(fixtures.invalidInput);
      } catch (e) {
        thrown = e;
      }
      expect(
        thrown,
        `execute() threw ${String(thrown)} instead of returning { success: false, error }. ` +
          `A caller three layers up should see a typed failure, not catch an adapter's raw exception.`,
      ).toBeUndefined();
      expect(result?.success, "invalid input must report success: false").toBe(false);
      expect(result?.error, "a failure must include an error message").toBeTruthy();
    });
  });
}
