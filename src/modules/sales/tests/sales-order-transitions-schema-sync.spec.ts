/**
 * J12 exit criterion, second sentence: "A new state added without tests
 * fails CI."
 *
 * ORDER_STATUS_TRANSITIONS (sales.service.ts) is a fixed map keyed by
 * every sales-order status. updateSalesOrderStatusSchema
 * (@kannan19302/shared) is the caller-facing enum of settable statuses.
 * If someone adds a new status to the schema's enum without adding a
 * matching entry (even an empty terminal one) to the transitions map,
 * that new state has zero defined transitions — every transition INTO
 * or OUT OF it would silently fall through the `?? []` default and be
 * rejected as if it were simply undefined, rather than deliberately
 * reviewed and named. This test makes that omission a build failure
 * instead of a silent gap.
 */
import { describe, it, expect } from "vitest";
import { updateSalesOrderStatusSchema } from "@kannan19302/shared";
import { ORDER_STATUS_TRANSITIONS } from "../sales.service";

describe("sales order status transitions — schema sync", () => {
  it("J12: every status in updateSalesOrderStatusSchema has a corresponding ORDER_STATUS_TRANSITIONS entry", () => {
    const schemaStatuses = updateSalesOrderStatusSchema.shape.status.options as string[];
    const missing = schemaStatuses.filter(
      (s) => !(s in ORDER_STATUS_TRANSITIONS),
    );
    expect(missing).toEqual([]);
  });

  it("J12: every transition target named in the map is itself a real status the schema knows about", () => {
    const schemaStatuses = new Set(
      updateSalesOrderStatusSchema.shape.status.options as string[],
    );
    const unknownTargets: string[] = [];
    for (const targets of Object.values(ORDER_STATUS_TRANSITIONS)) {
      for (const target of targets) {
        if (!schemaStatuses.has(target) && target !== "CREDIT_HOLD") {
          unknownTargets.push(target);
        }
      }
    }
    expect(unknownTargets).toEqual([]);
  });
});
