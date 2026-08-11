/**
 * E06 exit criterion: "A posted document is never mutated — it is
 * reversed. Closing a period makes its documents immutable, provably."
 *
 * This spec proves the WIRING: GlAccountingService.postJournal() and
 * reverseJournal() actually consult PeriodCloseGuardService before
 * mutating the ledger, not just that the guard itself works in isolation
 * (already proven in finance/tests/period-close-guard.service.spec.ts).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

let journals: any[];
let periods: any[];
let accounts: any[];

vi.mock("@kannan19302/database", () => ({
  prisma: {
    journal: {
      findFirst: vi.fn(({ where }: any) => journals.find((j) => j.id === where.id && j.tenantId === where.tenantId) ?? null),
    },
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
    account: { findUnique: vi.fn(({ where }: any) => accounts.find((a) => a.id === where.id) ?? null) },
    $transaction: vi.fn((fn: any) => fn({
      account: { update: vi.fn((args: any) => args), findUnique: vi.fn(({ where }: any) => accounts.find((a) => a.id === where.id) ?? null) },
      journal: {
        update: vi.fn((args: any) => args),
        create: vi.fn((args: any) => ({ id: "rev-1", ...args.data })),
        findFirst: vi.fn(({ where }: any) => journals.find((j) => j.id === where.id) ?? { id: "rev-1", entries: [] }),
      },
      journalEntry: { create: vi.fn((args: any) => args) },
      accountingBook: { findFirst: vi.fn(() => null) },
    })),
  },
}));

import { GlAccountingService } from "../gl-accounting.service";
import { PeriodCloseGuardService } from "../../../finance/period-close-guard.service";

describe("E06 · GlAccountingService is wired to the period-close guard", () => {
  let gl: GlAccountingService;

  beforeEach(() => {
    vi.clearAllMocks();
    journals = [];
    periods = [];
    accounts = [{ id: "acc-1", type: "EXPENSE", balance: 0 }];
    gl = new GlAccountingService(undefined, new PeriodCloseGuardService());
  });

  it("REFUSES postJournal for a journal dated inside a CLOSED period", async () => {
    periods.push({ id: "p1", tenantId: "t1", orgId: "org1", name: "Jan-2026", startDate: new Date("2026-01-01"), endDate: new Date("2026-01-31"), status: "CLOSED" });
    journals.push({ id: "j1", tenantId: "t1", orgId: "org1", status: "DRAFT", date: new Date("2026-01-15"), entries: [{ accountId: "acc-1", debit: 100, credit: 0 }] });

    await expect(gl.postJournal("t1", "j1")).rejects.toThrow(/CLOSED/);
  });

  it("ALLOWS postJournal for a journal dated inside an OPEN period", async () => {
    periods.push({ id: "p1", tenantId: "t1", orgId: "org1", name: "Feb-2026", startDate: new Date("2026-02-01"), endDate: new Date("2026-02-28"), status: "OPEN" });
    journals.push({ id: "j2", tenantId: "t1", orgId: "org1", status: "DRAFT", date: new Date("2026-02-15"), entries: [{ accountId: "acc-1", debit: 100, credit: 0 }] });

    await expect(gl.postJournal("t1", "j2")).resolves.toBeDefined();
  });

  it("REFUSES reverseJournal when the reversal date falls inside a CLOSED period", async () => {
    periods.push({ id: "p1", tenantId: "t1", orgId: "org1", name: "Jan-2026", startDate: new Date("2026-01-01"), endDate: new Date("2026-01-31"), status: "CLOSED" });
    journals.push({ id: "j3", tenantId: "t1", orgId: "org1", status: "POSTED", entryNumber: "JE-3", notes: "", date: new Date("2025-12-01"), entries: [{ accountId: "acc-1", debit: 100, credit: 0 }] });

    await expect(gl.reverseJournal("t1", "j3", "2026-01-15")).rejects.toThrow(/CLOSED/);
  });
});
