import { Injectable, Logger } from "@nestjs/common";
import { prisma } from "@kannan19302/database";

export interface SubledgerInvariantCheckResult {
  subledger: "AR" | "AP" | "CASH" | "DOUBLE_ENTRY";
  name: string;
  subledgerBalance: number;
  glControlBalance: number;
  discrepancy: number;
  status: "HEALTHY" | "WARNING" | "CRITICAL";
  controlAccountCode: string;
  detail: string;
}

export interface SubledgerInvariantReport {
  tenantId: string;
  timestamp: string;
  overallStatus: "HEALTHY" | "WARNING" | "CRITICAL";
  checks: SubledgerInvariantCheckResult[];
  summary: {
    totalSubledgerVolume: number;
    totalGlVolume: number;
    maxDiscrepancy: number;
    unreconciledCount: number;
  };
}

@Injectable()
export class SubledgerInvariantService {
  private readonly logger = new Logger(SubledgerInvariantService.name);

  /**
   * Evaluates all core subledger-to-GL equality invariants for a tenant:
   * 1. AR Subledger (open customer invoices) vs GL Control 1200
   * 2. AP Subledger (open vendor bills) vs GL Control 2000
   * 3. Bank / Cash Subledger (bank account balances) vs GL Control 1000
   * 4. Double-Entry Balanced Invariant (sum of posted debits vs credits)
   */
  async validateSubledgerInvariants(tenantId: string): Promise<SubledgerInvariantReport> {
    const checks: SubledgerInvariantCheckResult[] = [];

    // 1. AR Subledger vs GL 1200
    const arCheck = await this.checkArInvariant(tenantId);
    checks.push(arCheck);

    // 2. AP Subledger vs GL 2000
    const apCheck = await this.checkApInvariant(tenantId);
    checks.push(apCheck);

    // 3. Cash Subledger vs GL 1000
    const cashCheck = await this.checkCashInvariant(tenantId);
    checks.push(cashCheck);

    // 4. Double-Entry Invariant (Debits == Credits)
    const doubleEntryCheck = await this.checkDoubleEntryInvariant(tenantId);
    checks.push(doubleEntryCheck);

    const maxDiscrepancy = Math.max(...checks.map((c) => c.discrepancy));
    const unreconciledCount = checks.filter((c) => c.status !== "HEALTHY").length;

    let overallStatus: "HEALTHY" | "WARNING" | "CRITICAL" = "HEALTHY";
    if (checks.some((c) => c.status === "CRITICAL")) {
      overallStatus = "CRITICAL";
    } else if (checks.some((c) => c.status === "WARNING")) {
      overallStatus = "WARNING";
    }

    const totalSubledgerVolume = checks.reduce((acc, c) => acc + c.subledgerBalance, 0);
    const totalGlVolume = checks.reduce((acc, c) => acc + c.glControlBalance, 0);

    return {
      tenantId,
      timestamp: new Date().toISOString(),
      overallStatus,
      checks,
      summary: {
        totalSubledgerVolume: Number(totalSubledgerVolume.toFixed(2)),
        totalGlVolume: Number(totalGlVolume.toFixed(2)),
        maxDiscrepancy: Number(maxDiscrepancy.toFixed(2)),
        unreconciledCount,
      },
    };
  }

  private async checkArInvariant(tenantId: string): Promise<SubledgerInvariantCheckResult> {
    // Open invoices subledger sum
    const openInvoices = await prisma.invoice.findMany({
      where: {
        tenantId,
        status: { in: ["SENT", "OVERDUE", "PARTIALLY_PAID"] },
      },
      select: { totalAmount: true, paidAmount: true },
    });

    const arSubledgerBalance = openInvoices.reduce(
      (sum, inv) => sum + (Number(inv.totalAmount || 0) - Number(inv.paidAmount || 0)),
      0,
    );

    // GL 1200 Control Account net balance (Asset: debit increases, credit decreases)
    const glArBalance = await this.calculateGlAccountBalance(tenantId, "1200", "DEBIT_NORMAL");
    const discrepancy = Math.abs(Number((arSubledgerBalance - glArBalance).toFixed(2)));

    let status: "HEALTHY" | "WARNING" | "CRITICAL" = "HEALTHY";
    if (discrepancy >= 1.0) {
      status = "CRITICAL";
    } else if (discrepancy > 0.01) {
      status = "WARNING";
    }

    return {
      subledger: "AR",
      name: "Accounts Receivable Subledger vs GL 1200",
      subledgerBalance: Number(arSubledgerBalance.toFixed(2)),
      glControlBalance: Number(glArBalance.toFixed(2)),
      discrepancy,
      status,
      controlAccountCode: "1200",
      detail:
        status === "HEALTHY"
          ? "AR subledger matches GL Control Account 1200 exactly."
          : `Discrepancy of $${discrepancy.toFixed(2)} between open AR invoices and GL Control Account 1200.`,
    };
  }

  private async checkApInvariant(tenantId: string): Promise<SubledgerInvariantCheckResult> {
    // Open vendor bills subledger sum
    const openBills = await prisma.vendorBill.findMany({
      where: {
        tenantId,
        status: { in: ["PENDING", "APPROVED", "PARTIALLY_PAID"] },
      },
      select: { totalAmount: true, paidAmount: true },
    });

    const apSubledgerBalance = openBills.reduce(
      (sum, bill) => sum + (Number(bill.totalAmount || 0) - Number(bill.paidAmount || 0)),
      0,
    );

    // GL 2000 Control Account net balance (Liability: credit increases, debit decreases)
    const glApBalance = await this.calculateGlAccountBalance(tenantId, "2000", "CREDIT_NORMAL");
    const discrepancy = Math.abs(Number((apSubledgerBalance - glApBalance).toFixed(2)));

    let status: "HEALTHY" | "WARNING" | "CRITICAL" = "HEALTHY";
    if (discrepancy >= 1.0) {
      status = "CRITICAL";
    } else if (discrepancy > 0.01) {
      status = "WARNING";
    }

    return {
      subledger: "AP",
      name: "Accounts Payable Subledger vs GL 2000",
      subledgerBalance: Number(apSubledgerBalance.toFixed(2)),
      glControlBalance: Number(glApBalance.toFixed(2)),
      discrepancy,
      status,
      controlAccountCode: "2000",
      detail:
        status === "HEALTHY"
          ? "AP subledger matches GL Control Account 2000 exactly."
          : `Discrepancy of $${discrepancy.toFixed(2)} between open AP bills and GL Control Account 2000.`,
    };
  }

  private async checkCashInvariant(tenantId: string): Promise<SubledgerInvariantCheckResult> {
    let cashSubledgerBalance = 0;
    if ((prisma as any).bankAccount?.findMany) {
      const bankAccounts = await (prisma as any).bankAccount.findMany({ where: { tenantId } }).catch(() => []);
      if (bankAccounts && bankAccounts.length > 0) {
        cashSubledgerBalance = bankAccounts.reduce((acc: number, b: any) => acc + Number(b.balance || 0), 0);
      }
    }
    if (cashSubledgerBalance === 0 && (prisma as any).treasuryTransaction?.aggregate) {
      const treasurySum = await (prisma as any).treasuryTransaction
        .aggregate({
          where: { tenantId, status: "SETTLED" },
          _sum: { amount: true },
        })
        .catch(() => ({ _sum: { amount: null } }));
      cashSubledgerBalance = Number(treasurySum._sum?.amount ?? 0);
    }

    // GL 1000 Control Account net balance (Asset: debit increases, credit decreases)
    const glCashBalance = await this.calculateGlAccountBalance(tenantId, "1000", "DEBIT_NORMAL");
    const discrepancy = Math.abs(Number((cashSubledgerBalance - glCashBalance).toFixed(2)));

    let status: "HEALTHY" | "WARNING" | "CRITICAL" = "HEALTHY";
    if (discrepancy >= 1.0) {
      status = "CRITICAL";
    } else if (discrepancy > 0.01) {
      status = "WARNING";
    }

    return {
      subledger: "CASH",
      name: "Bank Subledger vs GL 1000 (Cash & Cash Equivalents)",
      subledgerBalance: Number(cashSubledgerBalance.toFixed(2)),
      glControlBalance: Number(glCashBalance.toFixed(2)),
      discrepancy,
      status,
      controlAccountCode: "1000",
      detail:
        status === "HEALTHY"
          ? "Bank accounts total matches GL Control Account 1000 exactly."
          : `Discrepancy of $${discrepancy.toFixed(2)} between bank accounts and GL Control Account 1000.`,
    };
  }

  private async checkDoubleEntryInvariant(tenantId: string): Promise<SubledgerInvariantCheckResult> {
    const postedEntries = await prisma.journalEntry.findMany({
      where: {
        tenantId,
        journal: { status: "POSTED" },
      },
      select: { debit: true, credit: true },
    });

    const totalDebits = postedEntries.reduce((sum, e) => sum + Number(e.debit || 0), 0);
    const totalCredits = postedEntries.reduce((sum, e) => sum + Number(e.credit || 0), 0);
    const discrepancy = Math.abs(Number((totalDebits - totalCredits).toFixed(2)));

    let status: "HEALTHY" | "WARNING" | "CRITICAL" = "HEALTHY";
    if (discrepancy >= 0.01) {
      status = "CRITICAL"; // Any double-entry imbalance is a critical accounting violation
    }

    return {
      subledger: "DOUBLE_ENTRY",
      name: "Double-Entry Invariant (Debits == Credits)",
      subledgerBalance: Number(totalDebits.toFixed(2)),
      glControlBalance: Number(totalCredits.toFixed(2)),
      discrepancy,
      status,
      controlAccountCode: "ALL_POSTED",
      detail:
        status === "HEALTHY"
          ? "All posted journal lines strictly obey the double-entry equality invariant (Debits == Credits)."
          : `Double-entry imbalance detected! Total Debits ($${totalDebits.toFixed(2)}) != Total Credits ($${totalCredits.toFixed(2)}). Delta: $${discrepancy.toFixed(2)}.`,
    };
  }

  private async calculateGlAccountBalance(
    tenantId: string,
    accountCode: string,
    normalSide: "DEBIT_NORMAL" | "CREDIT_NORMAL",
  ): Promise<number> {
    const account = await prisma.account.findFirst({
      where: {
        tenantId,
        code: accountCode,
      },
      select: { id: true },
    });

    if (!account) {
      return 0;
    }

    const entries = await prisma.journalEntry.findMany({
      where: {
        tenantId,
        accountId: account.id,
        journal: { status: "POSTED" },
      },
      select: { debit: true, credit: true },
    });

    const totalDebits = entries.reduce((sum, e) => sum + Number(e.debit || 0), 0);
    const totalCredits = entries.reduce((sum, e) => sum + Number(e.credit || 0), 0);

    if (normalSide === "DEBIT_NORMAL") {
      return totalDebits - totalCredits;
    } else {
      return totalCredits - totalDebits;
    }
  }
}
