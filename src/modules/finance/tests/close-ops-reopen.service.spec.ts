/**
 * E06 exit criterion: "...and reopening requires an approver."
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

let periods: any[];
let approvalRequests: any[];

vi.mock("@kannan19302/database", () => ({
  prisma: {
    financialPeriod: {
      findFirst: vi.fn(({ where }: any) => periods.find((p) => p.id === where.id && p.tenantId === where.tenantId) ?? null),
      update: vi.fn(({ where, data }: any) => {
        const p = periods.find((x) => x.id === where.id);
        Object.assign(p, data);
        return p;
      }),
    },
    approvalRequest: {
      findFirst: vi.fn(({ where }: any) =>
        approvalRequests.find(
          (r) => r.tenantId === where.tenantId && r.entityType === where.entityType && r.entityId === where.entityId && r.status === where.status,
        ) ?? null,
      ),
    },
  },
}));

import { CloseOpsService } from "../close-ops.service";

describe("E06 · reopening a closed period requires an approver — not a bare status flip", () => {
  let service: CloseOpsService;

  beforeEach(() => {
    vi.clearAllMocks();
    periods = [{ id: "p1", tenantId: "t1", orgId: "org1", name: "Jan-2026", status: "CLOSED" }];
    approvalRequests = [];
    service = new CloseOpsService();
  });

  it("REFUSES to reopen a closed period when no APPROVED reopen request exists — the exit criterion's own words", async () => {
    await expect(service.reopenFinancialPeriod("t1", "p1")).rejects.toThrow(/approv/i);
    expect(periods[0].status).toBe("CLOSED"); // unchanged
  });

  it("REFUSES when a reopen request exists but is still PENDING, not yet approved", async () => {
    approvalRequests.push({ id: "req-1", tenantId: "t1", entityType: "financial-period-reopen", entityId: "p1", status: "PENDING" });
    await expect(service.reopenFinancialPeriod("t1", "p1")).rejects.toThrow(/approv/i);
    expect(periods[0].status).toBe("CLOSED");
  });

  it("ALLOWS reopening once a real APPROVED reopen request exists for this exact period", async () => {
    approvalRequests.push({ id: "req-1", tenantId: "t1", entityType: "financial-period-reopen", entityId: "p1", status: "APPROVED" });
    const result = await service.reopenFinancialPeriod("t1", "p1");
    expect(result.status).toBe("OPEN");
  });
});
