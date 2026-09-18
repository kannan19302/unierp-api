import { describe, it, expect, vi, beforeEach } from "vitest";
import { BillingService } from "../services/billing.service";

describe("BillingService · Customer Portal Session (Revenue-First SaaS)", () => {
  let service: BillingService;

  beforeEach(() => {
    service = new BillingService(undefined as any, undefined as any);
  });

  it("returns fallback / simulated portal URL when Stripe is unconfigured in test environment", async () => {
    const tenantId = "00000000-0000-0000-0000-000000000001";
    const returnUrl = "http://localhost:4003/billing";

    const result = await service.createCustomerPortalSession(tenantId, returnUrl);

    expect(result).toBeDefined();
    expect(result.url).toContain("portal_session=sim_");
    expect(result.url).toContain(`tenantId=${tenantId}`);
    expect(result.url).toContain(returnUrl);
  });

  it("preserves existing query parameters in returnUrl", async () => {
    const tenantId = "test-tenant-42";
    const returnUrl = "http://localhost:4003/billing?view=invoices";

    const result = await service.createCustomerPortalSession(tenantId, returnUrl);

    expect(result.url).toContain("&portal_session=sim_");
    expect(result.url).toContain("view=invoices");
  });
});
