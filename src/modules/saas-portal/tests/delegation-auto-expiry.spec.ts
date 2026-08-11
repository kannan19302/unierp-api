/**
 * D03 exit criterion (delegation half): "A delegation expires
 * automatically." SaasPortalDelegationService.list() lazily marks any
 * ACTIVE delegation past its endDate as EXPIRED before returning — this
 * spec proves that mechanism directly (previously zero test coverage
 * existed for it), and that a still-time-boxed delegation stays ACTIVE.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

let delegations: any[];
let users: any[];

vi.mock("@kannan19302/database", () => ({
  prisma: {
    delegation: {
      updateMany: vi.fn(({ where, data }: any) => {
        const matches = delegations.filter(
          (d) => d.tenantId === where.tenantId && d.status === where.status && d.endDate && d.endDate < where.endDate.lt,
        );
        for (const d of matches) Object.assign(d, data);
        return { count: matches.length };
      }),
      findMany: vi.fn(({ where }: any) =>
        delegations.filter((d) => d.tenantId === where.tenantId).sort((a, b) => b.createdAt - a.createdAt),
      ),
      create: vi.fn(({ data }: any) => {
        const row = { id: `del-${delegations.length + 1}`, createdAt: new Date(), updatedAt: new Date(), ...data };
        delegations.push(row);
        return row;
      }),
    },
  },
}));
vi.mock("@/common/idp-client", () => ({
  idpClient: {
    user: {
      findMany: vi.fn(({ where }: any) => users.filter((u) => where.id.in.includes(u.id))),
      findFirst: vi.fn(({ where }: any) => users.find((u) => u.id === where.id && u.tenantId === where.tenantId) ?? null),
    },
  },
}));

import { SaasPortalDelegationService } from "../services/delegation.service";

describe("D03 · a delegation expires automatically", () => {
  let delegationSvc: SaasPortalDelegationService;

  beforeEach(() => {
    vi.clearAllMocks();
    delegations = [];
    users = [
      { id: "u-delegator", tenantId: "t1", firstName: "Del", lastName: "Egator", email: "d@t1.com" },
      { id: "u-delegate", tenantId: "t1", firstName: "Del", lastName: "Egate", email: "e@t1.com" },
    ];
    delegationSvc = new SaasPortalDelegationService();
  });

  it("an ACTIVE delegation past its endDate is marked EXPIRED automatically on the next read — no manual revoke needed", async () => {
    await delegationSvc.create("t1", "u-delegator", [], {
      delegatorId: "u-delegator",
      delegateId: "u-delegate",
      type: "ALL",
      startDate: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
      endDate: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000), // ended yesterday
    });
    expect(delegations[0]!.status).toBe("ACTIVE"); // still ACTIVE right after creation

    const result = await delegationSvc.list("t1");

    expect(result).toHaveLength(1);
    expect(result[0]!.status).toBe("EXPIRED"); // flipped automatically by the read path
    expect(delegations[0]!.status).toBe("EXPIRED"); // the underlying row was actually updated, not just the response shaped
  });

  it("a delegation still within its time box stays ACTIVE", async () => {
    await delegationSvc.create("t1", "u-delegator", [], {
      delegatorId: "u-delegator",
      delegateId: "u-delegate",
      type: "ALL",
      startDate: new Date(),
      endDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days from now
    });

    const result = await delegationSvc.list("t1");
    expect(result[0]!.status).toBe("ACTIVE");
  });

  it("a delegation with NO endDate (open-ended) never auto-expires", async () => {
    await delegationSvc.create("t1", "u-delegator", [], {
      delegatorId: "u-delegator",
      delegateId: "u-delegate",
      type: "ALL",
      startDate: new Date(),
    });

    const result = await delegationSvc.list("t1");
    expect(result[0]!.status).toBe("ACTIVE");
  });
});
