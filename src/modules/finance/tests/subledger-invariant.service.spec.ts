import { describe, it, expect, vi, beforeEach } from "vitest";
import { SubledgerInvariantService } from "../services/subledger-invariant.service";
import { prisma } from "@kannan19302/database";

vi.mock("@kannan19302/database", () => {
  const createMockCollection = () => ({
    findMany: vi.fn(),
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    count: vi.fn(),
  });

  return {
    prisma: {
      invoice: createMockCollection(),
      vendorBill: createMockCollection(),
      bankAccount: createMockCollection(),
      account: createMockCollection(),
      journal: createMockCollection(),
      journalEntry: createMockCollection(),
    },
  };
});

describe("SubledgerInvariantService", () => {
  let service: SubledgerInvariantService;
  const tenantId = "tenant-fin-001";

  beforeEach(() => {
    vi.clearAllMocks();
    service = new SubledgerInvariantService();
  });

  it("evaluates a completely balanced ledger as HEALTHY with zero discrepancies", async () => {
    // 1. AR Subledger: 2 open invoices totaling $15,000 ($10k + $5k)
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([
      { totalAmount: 12000, paidAmount: 2000 },
      { totalAmount: 5000, paidAmount: 0 },
    ] as any);

    // GL Account 1200
    vi.mocked(prisma.account.findFirst).mockImplementation((args: any) => {
      if (args.where.code === "1200") return Promise.resolve({ id: "acc-1200" } as any);
      if (args.where.code === "2000") return Promise.resolve({ id: "acc-2000" } as any);
      if (args.where.code === "1000") return Promise.resolve({ id: "acc-1000" } as any);
      return Promise.resolve(null);
    });

    // Journal entries for AR (debit normal: 15,000 - 0 = 15,000)
    // Journal entries for AP (credit normal: 8,000 - 0 = 8,000)
    // Journal entries for Cash (debit normal: 25,000 - 0 = 25,000)
    // Posted journals general entries: debits 100,000 == credits 100,000
    vi.mocked(prisma.journalEntry.findMany).mockImplementation((args: any) => {
      if (args.where.accountId === "acc-1200") {
        return Promise.resolve([{ debit: 15000, credit: 0 }] as any);
      }
      if (args.where.accountId === "acc-2000") {
        return Promise.resolve([{ debit: 0, credit: 8000 }] as any);
      }
      if (args.where.accountId === "acc-1000") {
        return Promise.resolve([{ debit: 25000, credit: 0 }] as any);
      }
      // Double entry check query (no accountId in where)
      return Promise.resolve([
        { debit: 50000, credit: 0 },
        { debit: 50000, credit: 0 },
        { debit: 0, credit: 100000 },
      ] as any);
    });

    // 2. AP Subledger: 1 open bill totaling $8,000
    vi.mocked(prisma.vendorBill.findMany).mockResolvedValue([
      { totalAmount: 10000, paidAmount: 2000 },
    ] as any);

    // 3. Bank Subledger: 2 bank accounts totaling $25,000
    vi.mocked(prisma.bankAccount.findMany).mockResolvedValue([
      { balance: 15000 },
      { balance: 10000 },
    ] as any);

    const report = await service.validateSubledgerInvariants(tenantId);

    expect(report.tenantId).toBe(tenantId);
    expect(report.overallStatus).toBe("HEALTHY");
    expect(report.summary.maxDiscrepancy).toBe(0);
    expect(report.summary.unreconciledCount).toBe(0);

    const arCheck = report.checks.find((c) => c.subledger === "AR");
    expect(arCheck?.subledgerBalance).toBe(15000);
    expect(arCheck?.glControlBalance).toBe(15000);
    expect(arCheck?.discrepancy).toBe(0);
    expect(arCheck?.status).toBe("HEALTHY");

    const apCheck = report.checks.find((c) => c.subledger === "AP");
    expect(apCheck?.subledgerBalance).toBe(8000);
    expect(apCheck?.glControlBalance).toBe(8000);
    expect(apCheck?.status).toBe("HEALTHY");

    const cashCheck = report.checks.find((c) => c.subledger === "CASH");
    expect(cashCheck?.subledgerBalance).toBe(25000);
    expect(cashCheck?.glControlBalance).toBe(25000);
    expect(cashCheck?.status).toBe("HEALTHY");

    const deCheck = report.checks.find((c) => c.subledger === "DOUBLE_ENTRY");
    expect(deCheck?.subledgerBalance).toBe(100000);
    expect(deCheck?.glControlBalance).toBe(100000);
    expect(deCheck?.status).toBe("HEALTHY");
  });

  it("flags CRITICAL status when an AR discrepancy exceeds $1.00 threshold", async () => {
    // Open invoices = $15,000
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([
      { totalAmount: 15000, paidAmount: 0 },
    ] as any);

    vi.mocked(prisma.account.findFirst).mockResolvedValue({ id: "acc-1200" } as any);

    // GL Control 1200 = only $14,500 ($500 missing journal entry)
    vi.mocked(prisma.journalEntry.findMany).mockImplementation((args: any) => {
      if (args.where.accountId === "acc-1200") {
        return Promise.resolve([{ debit: 14500, credit: 0 }] as any);
      }
      return Promise.resolve([]);
    });

    vi.mocked(prisma.vendorBill.findMany).mockResolvedValue([]);
    vi.mocked(prisma.bankAccount.findMany).mockResolvedValue([]);

    const report = await service.validateSubledgerInvariants(tenantId);

    expect(report.overallStatus).toBe("CRITICAL");
    const arCheck = report.checks.find((c) => c.subledger === "AR");
    expect(arCheck?.discrepancy).toBe(500);
    expect(arCheck?.status).toBe("CRITICAL");
  });

  it("flags CRITICAL status when double-entry debits != credits", async () => {
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([]);
    vi.mocked(prisma.vendorBill.findMany).mockResolvedValue([]);
    vi.mocked(prisma.bankAccount.findMany).mockResolvedValue([]);
    vi.mocked(prisma.account.findFirst).mockResolvedValue(null);

    // Debits = 10,000, Credits = 9,990 (imbalance of $10)
    vi.mocked(prisma.journalEntry.findMany).mockResolvedValue([
      { debit: 10000, credit: 0 },
      { debit: 0, credit: 9990 },
    ] as any);

    const report = await service.validateSubledgerInvariants(tenantId);

    expect(report.overallStatus).toBe("CRITICAL");
    const deCheck = report.checks.find((c) => c.subledger === "DOUBLE_ENTRY");
    expect(deCheck?.discrepancy).toBe(10);
    expect(deCheck?.status).toBe("CRITICAL");
  });

  it("flags WARNING status when minor rounding discrepancies (< $1.00) exist", async () => {
    // Invoices = 1000.05, GL = 1000.00
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([
      { totalAmount: 1000.05, paidAmount: 0 },
    ] as any);

    vi.mocked(prisma.account.findFirst).mockImplementation((args: any) => {
      if (args.where.code === "1200") return Promise.resolve({ id: "acc-1200" } as any);
      return Promise.resolve(null);
    });

    vi.mocked(prisma.journalEntry.findMany).mockImplementation((args: any) => {
      if (args.where.accountId === "acc-1200") {
        return Promise.resolve([{ debit: 1000.0, credit: 0 }] as any);
      }
      return Promise.resolve([]);
    });

    vi.mocked(prisma.vendorBill.findMany).mockResolvedValue([]);
    vi.mocked(prisma.bankAccount.findMany).mockResolvedValue([]);

    const report = await service.validateSubledgerInvariants(tenantId);

    expect(report.overallStatus).toBe("WARNING");
    const arCheck = report.checks.find((c) => c.subledger === "AR");
    expect(arCheck?.discrepancy).toBe(0.05);
    expect(arCheck?.status).toBe("WARNING");
  });
});
