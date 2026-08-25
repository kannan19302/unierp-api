import { describe, expect, it } from "vitest";
import {
  offboardTenantSchema,
  tenantLifecycleReasonSchema,
} from "./tenant-lifecycle.dto";

describe("tenant lifecycle reason contracts", () => {
  it("accepts an audited operator justification", () => {
    expect(
      tenantLifecycleReasonSchema.parse({ reason: "INC-1001 approved by platform operations" }),
    ).toEqual({ reason: "INC-1001 approved by platform operations" });
  });

  it("rejects a reason shorter than the break-glass minimum", () => {
    expect(() => tenantLifecycleReasonSchema.parse({ reason: "too short" })).toThrow();
  });

  it("preserves the offboarding retention default for existing callers", () => {
    expect(offboardTenantSchema.parse({})).toEqual({ retentionDays: 90 });
  });
});
