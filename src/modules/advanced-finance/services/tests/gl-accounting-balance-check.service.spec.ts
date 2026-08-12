/**
 * E09 exit criterion: "Double-entry provably balanced."
 *
 * GlAccountingService.postJournalToBook() checked balance via
 * `Math.abs(totalDebit - totalCredit) > 0.01` on floating-point numbers —
 * an epsilon-tolerant FLOAT comparison for the exact check that decides
 * whether money is allowed into the ledger. CODE_STANDARDS' own rule:
 * "Money is Decimal(19,4)... never converted to number for arithmetic."
 * The same file's own reverseJournalToBook() elsewhere correctly uses
 * Decimal.equals() for an equivalent check — this is a genuine
 * inconsistency, not a hypothetical one.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

let books: any[];
let journals: any[];
let journalEntries: any[];

vi.mock("@kannan19302/database", () => ({
  prisma: {
    accountingBook: {
      findFirst: vi.fn(({ where }: any) => books.find((b) => b.id === where.id && b.tenantId === where.tenantId && b.isActive) ?? null),
    },
    journal: {
      create: vi.fn(({ data }: any) => {
        const row = { id: `j-${journals.length + 1}`, ...data };
        journals.push(row);
        return row;
      }),
      findFirst: vi.fn(({ where }: any) => {
        const j = journals.find((x) => x.id === where.id);
        if (!j) return null;
        return { ...j, entries: journalEntries.filter((e) => e.journalId === j.id) };
      }),
    },
    journalEntry: {
      createMany: vi.fn(({ data }: any) => {
        for (const d of data) journalEntries.push({ id: `je-${journalEntries.length + 1}`, ...d });
        return { count: data.length };
      }),
    },
    $transaction: vi.fn((fn: any) => fn({
      journal: {
        create: vi.fn(({ data }: any) => {
          const row = { id: `j-${journals.length + 1}`, ...data };
          journals.push(row);
          return row;
        }),
        findFirst: vi.fn(({ where }: any) => {
          const j = journals.find((x) => x.id === where.id);
          if (!j) return null;
          return { ...j, entries: journalEntries.filter((e) => e.journalId === j.id) };
        }),
        findUnique: vi.fn(({ where }: any) => {
          const j = journals.find((x) => x.id === where.id);
          if (!j) return null;
          return { ...j, entries: journalEntries.filter((e) => e.journalId === j.id) };
        }),
      },
      journalEntry: {
        createMany: vi.fn(({ data }: any) => {
          for (const d of data) journalEntries.push({ id: `je-${journalEntries.length + 1}`, ...d });
          return { count: data.length };
        }),
        create: vi.fn(({ data }: any) => {
          const row = { id: `je-${journalEntries.length + 1}`, ...data };
          journalEntries.push(row);
          return row;
        }),
      },
    })),
  },
}));

import { GlAccountingService } from "../gl-accounting.service";

describe("E09 · GlAccountingService.postJournalToBook() balance check is exact, not float-tolerant", () => {
  let service: GlAccountingService;

  beforeEach(() => {
    vi.clearAllMocks();
    books = [{ id: "book-1", tenantId: "t1", isActive: true }];
    journals = [];
    journalEntries = [];
    service = new GlAccountingService();
  });

  it("REFUSES a journal that is unbalanced by half a cent — genuinely wrong money, not float noise", async () => {
    // The OLD code checked `Math.abs(totalDebit - totalCredit) > 0.01` —
    // an epsilon-TOLERANT check that silently ACCEPTS any imbalance up
    // to a full cent as "close enough." A journal off by 0.005 is
    // mathematically wrong (debits must equal credits exactly, to the
    // last minor unit) but the old code posted it anyway, since
    // 0.005 is not > 0.01.
    await expect(
      service.postJournalToBook("t1", "org1", "book-1", {
        entryNumber: "JE-1",
        date: "2026-01-01",
        entries: [
          { accountId: "acc-1", debit: 100.0, credit: 0 },
          { accountId: "acc-2", debit: 0, credit: 99.995 },
        ],
      }),
    ).rejects.toThrow(/not balanced/i);
    expect(journals.length).toBe(0); // never posted
  });

  it("ALLOWS a journal that is genuinely balanced, using exact Decimal arithmetic (no float drift false-positive)", async () => {
    // A classic float-drift case: 0.1 + 0.2 !== 0.3 in IEEE 754. A
    // Decimal-based check must not falsely reject entries that are
    // exactly balanced in real currency terms.
    const result = await service.postJournalToBook("t1", "org1", "book-1", {
      entryNumber: "JE-2",
      date: "2026-01-01",
      entries: [
        { accountId: "acc-1", debit: 0.1, credit: 0 },
        { accountId: "acc-2", debit: 0.2, credit: 0 },
        { accountId: "acc-3", debit: 0, credit: 0.3 },
      ],
    });
    expect(result).toBeTruthy();
    expect(journals.length).toBe(1);
  });
});

describe("J10/D122 · GlAccountingService.createJournal() balance check is exact, not float-tolerant", () => {
  let service: GlAccountingService;

  beforeEach(() => {
    vi.clearAllMocks();
    books = [{ id: "book-1", tenantId: "t1", isActive: true }];
    journals = [];
    journalEntries = [];
    service = new GlAccountingService();
  });

  it("REFUSES the exact edge case a property test found: unbalanced by a tenth of a cent, silently accepted by the old epsilon check", async () => {
    // createJournal() used `Math.abs(debits - credits) > 0.01` — any
    // imbalance up to a full cent was accepted as "close enough." This is
    // the fast-check-found edge case from
    // gl-accounting-create-journal-balance.property.spec.ts, run directly
    // against the real service and its transaction.
    await expect(
      service.createJournal("t1", "org1", {
        entryNumber: "JE-3",
        entries: [
          { accountId: "acc-1", debit: 1, credit: 0 },
          { accountId: "acc-2", debit: 0, credit: 0.9999 },
        ],
      }),
    ).rejects.toThrow(/do not balance/i);
    expect(journals.length).toBe(0);
  });

  it("ALLOWS a genuinely balanced journal", async () => {
    const result = await service.createJournal("t1", "org1", {
      entryNumber: "JE-4",
      entries: [
        { accountId: "acc-1", debit: 0.1, credit: 0 },
        { accountId: "acc-2", debit: 0.2, credit: 0 },
        { accountId: "acc-3", debit: 0, credit: 0.3 },
      ],
    });
    expect(result).toBeTruthy();
    expect(journals.length).toBe(1);
  });
});
