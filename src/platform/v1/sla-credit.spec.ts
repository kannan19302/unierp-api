/**
 * M35 exit criterion (credit arithmetic half): "The credit arithmetic is
 * at 100% coverage."
 */
import { describe, it, expect } from "vitest";
import { calculateSlaCredit, DEFAULT_CREDIT_TIERS } from "./sla-credit";

describe("M35 · SLA credit arithmetic", () => {
  it("meeting or exceeding the target (>= 99.90%) earns no credit", () => {
    const result = calculateSlaCredit(99.95, "1000.00");
    expect(result.creditAmount).toBe("0.0000");
    expect(result.creditBps).toBe(0);
    expect(result.tierApplied).toBeNull();
  });

  it("exactly at the top tier boundary (99.90%) earns no credit -- strictly below, not at or below", () => {
    const result = calculateSlaCredit(99.9, "1000.00");
    expect(result.creditAmount).toBe("0.0000");
  });

  it("a minor breach (99.00% <= actual < 99.90%) earns a 10% credit", () => {
    const result = calculateSlaCredit(99.5, "1000.00");
    expect(result.creditBps).toBe(1000);
    expect(result.creditAmount).toBe("100.0000"); // 10% of 1000.00
    expect(result.tierApplied).toEqual({ belowPercentBps: 9990, creditBps: 1000 });
  });

  it("a major breach (95.00% <= actual < 99.00%) earns a 25% credit", () => {
    const result = calculateSlaCredit(97.0, "1000.00");
    expect(result.creditBps).toBe(2500);
    expect(result.creditAmount).toBe("250.0000");
  });

  it("a critical breach (actual < 95.00%) earns a 50% credit", () => {
    const result = calculateSlaCredit(80.0, "1000.00");
    expect(result.creditBps).toBe(5000);
    expect(result.creditAmount).toBe("500.0000");
  });

  it("credit rounds to the cent correctly on an odd fee", () => {
    // 25% of 333.33 = 83.3325 -> rounds to 83.33
    const result = calculateSlaCredit(97.0, "333.33");
    expect(result.creditAmount).toBe("83.3300");
  });

  it("a custom tier schedule is honoured instead of the default", () => {
    const customTiers = [{ belowPercentBps: 10000, creditBps: 10000 }]; // any breach -> 100%
    const result = calculateSlaCredit(99.99, "1000.00", customTiers);
    expect(result.creditAmount).toBe("1000.0000");
  });

  it("an empty tier schedule always earns no credit", () => {
    const result = calculateSlaCredit(0, "1000.00", []);
    expect(result.creditAmount).toBe("0.0000");
    expect(result.tierApplied).toBeNull();
  });

  it("a malformed monthlyFee string is refused, not silently coerced", () => {
    expect(() => calculateSlaCredit(80.0, "not-a-number")).toThrow(/not a valid decimal amount/);
  });

  it("the default tier schedule is exported and matches the documented conventional schedule", () => {
    expect(DEFAULT_CREDIT_TIERS).toEqual([
      { belowPercentBps: 9500, creditBps: 5000 },
      { belowPercentBps: 9900, creditBps: 2500 },
      { belowPercentBps: 9990, creditBps: 1000 },
    ]);
  });

  it("a zero monthly fee produces a zero credit even at the worst tier", () => {
    const result = calculateSlaCredit(50.0, "0.00");
    expect(result.creditAmount).toBe("0.0000");
    expect(result.creditBps).toBe(5000); // the tier still applies, the fee is just zero
  });

  it("a negative monthlyFee (a prior credit already applied) produces a negative credit, exact to the cent", () => {
    // Exercises toCents()'/centsToDecimalString()'s negative-sign branches
    // directly.
    const result = calculateSlaCredit(50.0, "-100.00");
    expect(result.creditAmount).toBe("-49.9900");
  });
});
