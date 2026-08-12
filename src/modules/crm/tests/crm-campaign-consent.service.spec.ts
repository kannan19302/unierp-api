/**
 * E23 exit criterion: "...consented communication via A21."
 *
 * A21's own exit criterion says "a per-user preference suppresses
 * delivery across all 45 modules" — but the CommunicationOptOut model it
 * would need to be checked against (unierp-api's own schema) has ZERO
 * usages anywhere in the codebase (grep confirms). buildAudience() never
 * excluded opted-out contacts/leads at all.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

let leads: any[];
let optOuts: any[];

vi.mock("@kannan19302/database", () => ({
  prisma: {
    lead: {
      findMany: vi.fn(({ where }: any) => leads.filter((l) => l.tenantId === where.tenantId && !l.deletedAt)),
      count: vi.fn(({ where }: any) => leads.filter((l) => l.tenantId === where.tenantId && !l.deletedAt).length),
    },
    communicationOptOut: {
      findMany: vi.fn(({ where }: any) =>
        optOuts.filter((o) => o.tenantId === where.tenantId && where.entityId.in.includes(o.entityId) && o.channel === where.channel),
      ),
    },
  },
}));

import { CrmCampaignManagementService } from "../crm-campaign-management.service";

describe("E23 · campaign audience-building excludes opted-out leads/contacts — consented communication via A21", () => {
  let service: CrmCampaignManagementService;

  beforeEach(() => {
    vi.clearAllMocks();
    leads = [
      { id: "lead-1", tenantId: "t1", deletedAt: null, firstName: "A", lastName: "One", email: "a@example.com", status: "NEW" },
      { id: "lead-2", tenantId: "t1", deletedAt: null, firstName: "B", lastName: "Two", email: "b@example.com", status: "NEW" },
    ];
    optOuts = [{ id: "oo-1", tenantId: "t1", entityType: "LEAD", entityId: "lead-2", channel: "EMAIL" }];
    service = new CrmCampaignManagementService();
  });

  it("REFUSES to include an opted-out lead in a campaign audience — the exit criterion's own words", async () => {
    const audience = await service.buildAudience("t1", { entityType: "LEAD", filters: [] });
    const includedIds = audience.sample.map((r) => r.id);
    expect(includedIds).toContain("lead-1");
    expect(includedIds).not.toContain("lead-2");
    expect(audience.totalCount).toBe(1);
  });

  it("includes everyone when no one has opted out — the filter never over-excludes", async () => {
    optOuts = [];
    const audience = await service.buildAudience("t1", { entityType: "LEAD", filters: [] });
    expect(audience.totalCount).toBe(2);
  });
});
