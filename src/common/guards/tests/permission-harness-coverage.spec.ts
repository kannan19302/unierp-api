/**
 * J04 exit criterion: "A harness asserting authorised → 200 and
 * unauthorised → 403 (not 404, not 500) for every endpoint. Every
 * endpoint has a permission test. Removing a @Permissions decorator
 * fails CI."
 *
 * This proves the GENERIC harness (permission-test-harness.ts)
 * genuinely reuses across controllers it was never hand-written for —
 * rbac-regression-sweep.spec.ts proved the mechanism for 5 controllers
 * with bespoke per-controller test code; this file proves the SAME
 * mechanism, refactored into one reusable function, against a
 * DIFFERENT set of controllers with zero new guard-wiring code per
 * endpoint.
 */
import { describe, it } from "vitest";
import { expectPermissionEnforced } from "../permission-test-harness";
import { BulkOperationsController } from "../../controllers/bulk-operations.controller";
import { ChangeHistoryController } from "../../controllers/change-history.controller";
import { DataQualityController } from "../../controllers/data-quality.controller";

describe("J04 · generic permission harness — authorised allowed, unauthorised refused with 403, for endpoints never covered before", () => {
  it("BulkOperationsController.bulkCreate enforces bulk-ops.create", async () => {
    await expectPermissionEnforced(BulkOperationsController, "bulkCreate", "bulk-ops.create");
  });

  it("BulkOperationsController.bulkDelete enforces bulk-ops.delete", async () => {
    await expectPermissionEnforced(BulkOperationsController, "bulkDelete", "bulk-ops.delete");
  });

  it("ChangeHistoryController.getHistory enforces admin.history.read", async () => {
    await expectPermissionEnforced(ChangeHistoryController, "getHistory", "admin.history.read");
  });

  it("DataQualityController.deduplicate enforces data-quality.deduplicate", async () => {
    await expectPermissionEnforced(DataQualityController, "deduplicate", "data-quality.deduplicate");
  });

  it("DataQualityController.mergeDuplicates enforces data-quality.merge", async () => {
    await expectPermissionEnforced(DataQualityController, "mergeDuplicates", "data-quality.merge");
  });
});
