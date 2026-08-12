/**
 * D09 exit criterion: "Opening balances imported from a template
 * produce a trial balance that reconciles to the source, and the
 * reconciliation statement is a downloadable artefact."
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

let accounts: any[];
let journals: any[];
let journalEntries: any[];
let seq = 0;
const nextId = (p: string) => `${p}-${++seq}`;

vi.mock("@prisma/client", () => ({
  Prisma: {
    Decimal: class Decimal {
      value: number;
      constructor(v: unknown) { this.value = Number(v); }
      toString() { return String(this.value); }
      valueOf() { return this.value; }
      add(other: Decimal | number) {
        return new Decimal(this.value + Number(other));
      }
      equals(other: Decimal | number) {
        return this.value === Number(other);
      }
    },
  },
}));

vi.mock("@kannan19302/database", () => {
  const txLike = {
    account: {
      findUnique: vi.fn(({ where: { id } }: any) => accounts.find((a) => a.id === id) ?? null),
      update: vi.fn(({ where: { id }, data }: any) => {
        const row = accounts.find((a) => a.id === id)!;
        if (data.balance?.increment !== undefined) row.balance = (row.balance ?? 0) + data.balance.increment;
        return row;
      }),
    },
    journal: {
      create: vi.fn(({ data }: any) => { const row = { id: nextId("jrnl"), status: "DRAFT", date: new Date(), ...data }; journals.push(row); return row; }),
      update: vi.fn(({ where: { id }, data }: any) => { const row = journals.find((j) => j.id === id)!; Object.assign(row, data); return row; }),
      findFirst: vi.fn(({ where }: any) => {
        const row = journals.find((j) => j.id === where.id && j.tenantId === where.tenantId);
        if (!row) return null;
        return { ...row, entries: journalEntries.filter((e) => e.journalId === row.id) };
      }),
      findUnique: vi.fn(({ where: { id } }: any) => {
        const row = journals.find((j) => j.id === id) ?? null;
        if (!row) return null;
        return { ...row, entries: journalEntries.filter((e) => e.journalId === id) };
      }),
      findMany: vi.fn(({ where }: any) =>
        journals.filter((j) => j.orgId === where.orgId && j.status === where.status && new Date(j.date) <= where.date.lte),
      ),
    },
    journalEntry: {
      create: vi.fn(({ data }: any) => { const row = { id: nextId("je"), ...data }; journalEntries.push(row); return row; }),
      findMany: vi.fn(({ where }: any) => journalEntries.filter((e) => where.accountId.in.includes(e.accountId))),
    },
    accountingBook: { findFirst: vi.fn(() => null) },
    financeAuditLog: { create: vi.fn() },
    organization: { findFirst: vi.fn(() => null) },
  };
  return {
    prisma: {
      account: {
        findFirst: vi.fn(({ where }: any) => accounts.find((a) => a.tenantId === where.tenantId && a.orgId === where.orgId && a.code === where.code) ?? null),
        create: vi.fn(({ data }: any) => { const row = { id: nextId("acct"), balance: 0, isActive: true, ...data }; accounts.push(row); return row; }),
        findMany: vi.fn(({ where }: any) => accounts.filter((a) => a.tenantId === where.tenantId && a.orgId === where.orgId && a.isActive)),
      },
      journal: txLike.journal,
      journalEntry: txLike.journalEntry,
      $transaction: vi.fn(async (cb: any) => cb(txLike)),
    },
  };
});

import { GlAccountingService } from "../gl-accounting.service";
import { FinancialReportingService } from "../financial-reporting.service";
import { OpeningBalanceMigrationService } from "../opening-balance-migration.service";

describe("D09 · opening balances import into a real trial balance and reconcile to the source", () => {
  let migration: OpeningBalanceMigrationService;

  beforeEach(() => {
    vi.clearAllMocks();
    accounts = [];
    journals = [];
    journalEntries = [];
    seq = 0;
    const gl = new GlAccountingService();
    const reporting = new FinancialReportingService(gl);
    migration = new OpeningBalanceMigrationService(gl, reporting);
  });

  const template = [
    { code: "1000", name: "Cash", type: "ASSET", debit: 10000, credit: 0 },
    { code: "3000", name: "Owner Equity", type: "EQUITY", debit: 0, credit: 10000 },
  ];

  it("REFUSES an unbalanced template before writing anything", async () => {
    const unbalanced = [{ code: "1000", name: "Cash", type: "ASSET", debit: 100, credit: 0 }];
    await expect(migration.importOpeningBalances("t1", "org-1", unbalanced)).rejects.toThrow(/does not balance/);
    expect(accounts).toHaveLength(0);
    expect(journals).toHaveLength(0);
  });

  it("IMPORTS a balanced template as one POSTED journal, creating accounts as needed", async () => {
    const journal = await migration.importOpeningBalances("t1", "org-1", template);
    expect(journal.status).toBe("POSTED");
    expect(accounts).toHaveLength(2);
    expect(journalEntries).toHaveLength(2);
  });

  it("PRODUCES a trial balance that RECONCILES to the source template", async () => {
    await migration.importOpeningBalances("t1", "org-1", template);

    const statement = await migration.reconcileOpeningBalances("t1", "org-1", template, "2026-08-11");

    expect(statement.reconciled).toBe(true);
    expect(statement.entries.every((e) => e.reconciled)).toBe(true);
    expect(statement.sourceTotalDebits).toBe(statement.trialBalanceTotalDebits);
    expect(statement.sourceTotalCredits).toBe(statement.trialBalanceTotalCredits);
  });

  it("the reconciliation statement is a DOWNLOADABLE ARTEFACT: a real, self-contained structured object naming every account", async () => {
    await migration.importOpeningBalances("t1", "org-1", template);
    const statement = await migration.reconcileOpeningBalances("t1", "org-1", template, "2026-08-11");

    expect(statement.entries.map((e) => e.accountCode).sort()).toEqual(["1000", "3000"]);
    expect(statement.generatedAt).toBeDefined();
    expect(statement.asOfDate).toBe("2026-08-11");
  });

  it("catches a genuine reconciliation FAILURE — a trial balance that diverges from the source is never reported as reconciled", async () => {
    await migration.importOpeningBalances("t1", "org-1", template);
    // Simulate drift: an account balance was altered after posting.
    accounts.find((a) => a.code === "1000")!.balance = 9000;
    journalEntries.find((e) => e.accountId === accounts.find((a) => a.code === "1000")!.id)!.debit = 9000;

    const statement = await migration.reconcileOpeningBalances("t1", "org-1", template, "2026-08-11");

    expect(statement.reconciled).toBe(false);
    expect(statement.entries.find((e) => e.accountCode === "1000")!.reconciled).toBe(false);
  });
});
