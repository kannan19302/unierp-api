/**
 * M27 exit criterion: "100% of ingested cost is either allocated or in
 * the unallocated bucket — the two sum to the ingested total, asserted to
 * the cent. The unallocated share is displayed, never hidden. Allocation
 * arithmetic is at 100% unit coverage per the DoD."
 *
 * This file exercises every branch of allocateLineItems() with no
 * database involved — the pure arithmetic in cost-allocation.ts is
 * fully covered here.
 */
import { describe, it, expect } from "vitest";
import { allocateLineItems, type AttributionLookupFn } from "./cost-allocation";

const complete = (tenantId: string, service: string, environment: string) => ({ tenantId, service, environment });

describe("M27 · cost allocation arithmetic", () => {
  it("a line item with a single, fully-attributed resource is fully allocated", () => {
    const lookup: AttributionLookupFn = (id) => (id === "res-1" ? complete("tenant-a", "billing", "prod") : null);
    const result = allocateLineItems(
      [{ lineItemId: "L1", amount: "100.00", resourceId: "res-1", sharedResourceIds: null }],
      lookup,
    );
    expect(result.allocated).toEqual([{ lineItemId: "L1", resourceId: "res-1", tenantId: "tenant-a", service: "billing", environment: "prod", amount: "100.0000" }]);
    expect(result.unallocated).toEqual([]);
    expect(result.allocatedTotal).toBe("100.0000");
    expect(result.unallocatedTotal).toBe("0.0000");
    expect(result.ingestedTotal).toBe("100.0000");
  });

  it("a line item whose resource has NO or INCOMPLETE attribution goes to the unallocated bucket, named", () => {
    const lookup: AttributionLookupFn = () => null;
    const result = allocateLineItems(
      [{ lineItemId: "L1", amount: "50.00", resourceId: "res-unattributed", sharedResourceIds: null }],
      lookup,
    );
    expect(result.allocated).toEqual([]);
    expect(result.unallocated).toEqual([
      { lineItemId: "L1", resourceId: "res-unattributed", reason: "incomplete-attribution", amount: "50.0000" },
    ]);
    expect(result.unallocatedTotal).toBe("50.0000");
    expect(result.ingestedTotal).toBe("50.0000");
  });

  it("a line item with no resource reference at all is unallocated with reason no-resource-reference", () => {
    const lookup: AttributionLookupFn = () => null;
    const result = allocateLineItems(
      [{ lineItemId: "L1", amount: "10.00", resourceId: null, sharedResourceIds: null }],
      lookup,
    );
    expect(result.unallocated).toEqual([{ lineItemId: "L1", resourceId: null, reason: "no-resource-reference", amount: "10.0000" }]);
  });

  it("a shared-cost line item splits evenly across resources when it divides exactly", () => {
    const lookup: AttributionLookupFn = (id) => complete(`tenant-of-${id}`, "shared-lb", "prod");
    const result = allocateLineItems(
      [{ lineItemId: "L1", amount: "100.00", resourceId: null, sharedResourceIds: ["res-a", "res-b"] }],
      lookup,
    );
    expect(result.allocated).toHaveLength(2);
    expect(result.allocated.map((a) => a.amount)).toEqual(["50.0000", "50.0000"]);
    expect(result.allocatedTotal).toBe("100.0000");
  });

  it("a shared-cost line item that does NOT divide evenly distributes the remainder cent-by-cent, still summing exactly", () => {
    const lookup: AttributionLookupFn = (id) => complete(`tenant-of-${id}`, "shared-lb", "prod");
    // 100.01 across 3 resources: 3334 + 3334 + 3333 cents = 10001 cents.
    const result = allocateLineItems(
      [{ lineItemId: "L1", amount: "100.01", resourceId: null, sharedResourceIds: ["res-a", "res-b", "res-c"] }],
      lookup,
    );
    expect(result.allocated.map((a) => a.amount)).toEqual(["33.3400", "33.3400", "33.3300"]);
    expect(result.allocatedTotal).toBe("100.0100");
    expect(result.ingestedTotal).toBe("100.0100");
  });

  it("a shared-cost line item with SOME resources attributed and others not splits between allocated and unallocated, still summing exactly", () => {
    const lookup: AttributionLookupFn = (id) => (id === "res-a" ? complete("tenant-a", "svc", "prod") : null);
    const result = allocateLineItems(
      [{ lineItemId: "L1", amount: "60.00", resourceId: null, sharedResourceIds: ["res-a", "res-b"] }],
      lookup,
    );
    expect(result.allocated).toEqual([{ lineItemId: "L1", resourceId: "res-a", tenantId: "tenant-a", service: "svc", environment: "prod", amount: "30.0000" }]);
    expect(result.unallocated).toEqual([{ lineItemId: "L1", resourceId: "res-b", reason: "incomplete-attribution", amount: "30.0000" }]);
    expect(result.allocatedTotal).toBe("30.0000");
    expect(result.unallocatedTotal).toBe("30.0000");
    expect(result.ingestedTotal).toBe("60.0000");
  });

  it("100% OF INGESTED COST is either allocated or unallocated — the two sum to the ingested total, to the cent, across a mixed batch", () => {
    const lookup: AttributionLookupFn = (id) => (id === "res-1" || id === "res-a" ? complete("tenant-1", "svc", "prod") : null);
    const result = allocateLineItems(
      [
        { lineItemId: "L1", amount: "100.00", resourceId: "res-1", sharedResourceIds: null }, // fully allocated
        { lineItemId: "L2", amount: "25.50", resourceId: "res-unknown", sharedResourceIds: null }, // unallocated
        { lineItemId: "L3", amount: "9.99", resourceId: null, sharedResourceIds: null }, // unallocated
        { lineItemId: "L4", amount: "40.01", resourceId: null, sharedResourceIds: ["res-a", "res-b", "res-c"] }, // split 3 ways, 1 allocated 2 not
      ],
      lookup,
    );

    // The exit criterion's own arithmetic assertion, done independently
    // here rather than trusting the service's own totals.
    const toCents = (s: string) => Math.round(Number(s) * 100);
    const sumAllocated = result.allocated.reduce((s, a) => s + toCents(a.amount), 0);
    const sumUnallocated = result.unallocated.reduce((s, u) => s + toCents(u.amount), 0);
    expect(sumAllocated + sumUnallocated).toBe(toCents(result.ingestedTotal));
    expect(toCents(result.allocatedTotal) + toCents(result.unallocatedTotal)).toBe(toCents(result.ingestedTotal));
    expect(result.ingestedTotal).toBe("175.5000");
  });

  it("an empty batch reconciles trivially: 0 allocated + 0 unallocated = 0 ingested", () => {
    const result = allocateLineItems([], () => null);
    expect(result.allocatedTotal).toBe("0.0000");
    expect(result.unallocatedTotal).toBe("0.0000");
    expect(result.ingestedTotal).toBe("0.0000");
  });

  it("a negative amount (a credit / late-arriving adjustment) is allocated and reconciled correctly", () => {
    const lookup: AttributionLookupFn = (id) => (id === "res-1" ? complete("tenant-a", "svc", "prod") : null);
    const result = allocateLineItems(
      [{ lineItemId: "L1", amount: "-15.50", resourceId: "res-1", sharedResourceIds: null }],
      lookup,
    );
    expect(result.allocated[0]!.amount).toBe("-15.5000");
    expect(result.allocatedTotal).toBe("-15.5000");
    expect(result.ingestedTotal).toBe("-15.5000");
  });

  it("a malformed amount string is refused explicitly, not silently coerced", () => {
    expect(() =>
      allocateLineItems([{ lineItemId: "L1", amount: "not-a-number", resourceId: null, sharedResourceIds: null }], () => null),
    ).toThrow(/is not a valid decimal amount/);
  });

  it("an amount string with no digits at all before the decimal point is refused", () => {
    expect(() =>
      allocateLineItems([{ lineItemId: "L1", amount: ".50", resourceId: null, sharedResourceIds: null }], () => null),
    ).toThrow(/is not a valid decimal amount/);
  });
});
