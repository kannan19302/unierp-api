import { ReconciliationEntry } from "@kannan19302/shared";
/**
 * D09 — migration templates for common sources: opening balances from a
 * mapped template (chart of accounts + debit/credit per account) import
 * as a real, POSTED GL journal — through GlAccountingService's existing
 * create/post pipeline, never a second ledger-writing path — and the
 * resulting trial balance (FinancialReportingService's existing
 * getTrialBalance(), unmodified) is reconciled against the source
 * template row-for-row.
 */
import { Injectable, BadRequestException } from "@nestjs/common";
import { prisma } from "@kannan19302/database";
import { GlAccountingService } from "./gl-accounting.service";
import { FinancialReportingService } from "./financial-reporting.service";

export interface OpeningBalanceRow {
  code: string;
  name: string;
  type: string;
  debit: number;
  credit: number;
}



export interface ReconciliationStatement {
  asOfDate: string;
  generatedAt: string;
  sourceTotalDebits: number;
  sourceTotalCredits: number;
  trialBalanceTotalDebits: number;
  trialBalanceTotalCredits: number;
  reconciled: boolean;
  entries: ReconciliationEntry[];
}

const EPSILON = 0.01;

@Injectable()
export class OpeningBalanceMigrationService {
  constructor(
    private readonly gl: GlAccountingService,
    private readonly reporting: FinancialReportingService,
  ) {}

  /**
   * Imports a mapped opening-balance template as one real, POSTED
   * journal. Refuses upfront (before any account or journal is created)
   * if the source template itself does not balance — a source that
   * can't ever reconcile is refused before anything is written, not
   * discovered afterward by comparing against a trial balance.
   */
  async importOpeningBalances(tenantId: string, orgId: string, rows: OpeningBalanceRow[]) {
    const totalDebit = rows.reduce((s, r) => s + r.debit, 0);
    const totalCredit = rows.reduce((s, r) => s + r.credit, 0);
    if (Math.abs(totalDebit - totalCredit) > EPSILON) {
      throw new BadRequestException(
        `Opening balance template does not balance: total debit ${totalDebit.toFixed(2)} != total credit ${totalCredit.toFixed(2)}`,
      );
    }

    const resolvedOrgId = await this.gl.resolveOrgId(tenantId, orgId);
    const accountIds: Record<string, string> = {};
    for (const row of rows) {
      const existing = await (prisma as any).account.findFirst({ where: { tenantId, orgId: resolvedOrgId, code: row.code } });
      if (existing) {
        accountIds[row.code] = existing.id;
      } else {
        const account = await this.gl.createAccount(tenantId, orgId, { code: row.code, name: row.name, type: row.type });
        accountIds[row.code] = account.id;
      }
    }

    const journal = await this.gl.createJournal(tenantId, orgId, {
      entryNumber: `OPENING-BALANCE-${Date.now()}`,
      notes: "Opening balance migration import",
      entries: rows.map((row) => ({
        accountId: accountIds[row.code]!,
        debit: row.debit,
        credit: row.credit,
        description: `Opening balance: ${row.name}`,
      })),
    });

    return this.gl.postJournal(tenantId, journal!.id);
  }

  /**
   * The downloadable artefact: the source template compared against the
   * CURRENT trial balance (FinancialReportingService's own, unmodified
   * getTrialBalance()), account by account, naming every discrepancy.
   */
  async reconcileOpeningBalances(tenantId: string, orgId: string, sourceRows: OpeningBalanceRow[], asOfDate: string): Promise<ReconciliationStatement> {
    const trialBalance = await this.reporting.getTrialBalance(tenantId, orgId, asOfDate);
    const tbByCode = new Map(trialBalance.accounts.map((a: any) => [a.code, a]));

    const entries: ReconciliationEntry[] = sourceRows.map((row) => {
      const tbAccount: any = tbByCode.get(row.code);
      const trialBalanceDebit = tbAccount?.debitTotal ?? 0;
      const trialBalanceCredit = tbAccount?.creditTotal ?? 0;
      const reconciled = Math.abs(trialBalanceDebit - row.debit) <= EPSILON && Math.abs(trialBalanceCredit - row.credit) <= EPSILON;
      return { accountCode: row.code, sourceDebit: row.debit, sourceCredit: row.credit, trialBalanceDebit, trialBalanceCredit, reconciled };
    });

    const sourceTotalDebits = sourceRows.reduce((s, r) => s + r.debit, 0);
    const sourceTotalCredits = sourceRows.reduce((s, r) => s + r.credit, 0);

    return {
      asOfDate,
      generatedAt: new Date().toISOString(),
      sourceTotalDebits,
      sourceTotalCredits,
      trialBalanceTotalDebits: trialBalance.totalDebits,
      trialBalanceTotalCredits: trialBalance.totalCredits,
      reconciled: entries.every((e) => e.reconciled),
      entries,
    };
  }
}
