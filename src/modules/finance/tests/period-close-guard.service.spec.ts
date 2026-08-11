/**
 * E06 exit criterion: "A posted document is never mutated — it is
 * reversed. Closing a period makes its documents immutable, provably, and
 * reopening requires an approver."
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

let periods: any[];

vi.mock("@kannan19302/database", () => ({
  prisma: {
    financialPeriod: {
      findFirst: vi.fn(({ where }: any) =>
        periods.find(
          (p) =>
            p.tenantId === where.tenantId &&
            p.orgId === where.orgId &&
            p.startDate <= where.startDate.lte &&
            p.endDate >= where.endDate.gte,
        ) ?? null,
      ),
    },
  },
}));

import { PeriodCloseGuardService } from "../period-close-guard.service";

describe("E06 · period-close guard — documents become provably immutable once their period closes", () => {
  let guard: PeriodCloseGuardService;

  beforeEach(() => {
    vi.clearAllMocks();
    periods = [];
    guard = new PeriodCloseGuardService();
  });

  function addPeriod(id: string, start: string, end: string, status: "OPEN" | "CLOSED") {
    periods.push({ id, tenantId: "t1", orgId: "org1", name: id, startDate: new Date(start), endDate: new Date(end), status });
  }

  it("ALLOWS posting a document dated inside an OPEN period", async () => {
    addPeriod("jan", "2026-01-01", "2026-01-31", "OPEN");
    await expect(guard.assertPeriodOpen("t1", "org1", new Date("2026-01-15"))).resolves.not.toThrow();
  });

  it("REFUSES to post/reverse a document dated inside a CLOSED period — the exit criterion's own words", async () => {
    addPeriod("jan", "2026-01-01", "2026-01-31", "CLOSED");
    await expect(guard.assertPeriodOpen("t1", "org1", new Date("2026-01-15"))).rejects.toThrow(/jan/i);
  });

  it("ALLOWS a document dated where no period record exists at all (no period defined, nothing to enforce)", async () => {
    addPeriod("jan", "2026-01-01", "2026-01-31", "CLOSED");
    await expect(guard.assertPeriodOpen("t1", "org1", new Date("2026-03-01"))).resolves.not.toThrow();
  });
});
