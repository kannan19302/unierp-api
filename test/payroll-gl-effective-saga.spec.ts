import { describe, it, expect, beforeEach } from "vitest";
import {
  resolveEffectiveAt,
  EffectiveInterval,
} from "@kannan19302/shared";

/**
 * HR Payroll & General Ledger Accounting Saga with Temporal Effective Dating (FND-P1-001 / FND-P1-002)
 *
 * Implements:
 * 1. Temporal Effective-Dated Employee Compensation Resolution
 * 2. Payroll Run Execution: Gross Pay, Tax/Benefits Withholding & Net Salary
 * 3. Double-Entry General Ledger Payroll Posting
 * 4. Treasury Bank Disbursement Settlement
 */

interface CompensationPackage {
  monthlyBaseSalary: number;
  taxRate: number;       // e.g. 0.22
  pensionRate: number;   // e.g. 0.06
  healthRate: number;    // e.g. 0.04
}

interface PayrollSlip {
  employeeId: string;
  payPeriod: string;
  grossPay: number;
  taxWithheld: number;
  pensionWithheld: number;
  healthWithheld: number;
  netPay: number;
}

interface JournalLine {
  accountCode: string;
  debit: number;
  credit: number;
}

interface JournalEntry {
  id: string;
  tenantId: string;
  sourceDocId: string;
  description: string;
  lines: JournalLine[];
}

describe("HR Payroll & GL Accounting Saga with Temporal Effective Dating", () => {
  const tenantId = "tenant-enterprise-hr";

  // Temporal salary history for senior engineer (promoted with raise on July 1, 2026)
  const salaryHistory: EffectiveInterval<CompensationPackage>[] = [
    {
      id: "comp-v1",
      entityId: "emp-701",
      validFrom: new Date("2026-01-01T00:00:00Z"),
      validTo: new Date("2026-07-01T00:00:00Z"),
      data: {
        monthlyBaseSalary: 8000,
        taxRate: 0.22,
        pensionRate: 0.06,
        healthRate: 0.04,
      },
    },
    {
      id: "comp-v2",
      entityId: "emp-701",
      validFrom: new Date("2026-07-01T00:00:00Z"),
      validTo: null, // open-ended current salary
      data: {
        monthlyBaseSalary: 10000,
        taxRate: 0.22,
        pensionRate: 0.06,
        healthRate: 0.04,
      },
    },
  ];

  let journalEntries: JournalEntry[];

  beforeEach(() => {
    journalEntries = [];
  });

  // Payroll Calculation Service using Effective Dating
  function calculateMonthlyPayroll(
    employeeId: string,
    periodDate: Date,
    payPeriodLabel: string
  ): PayrollSlip {
    // 1. Resolve active compensation slice at the exact point in time
    const activeSlice = resolveEffectiveAt(salaryHistory, periodDate);
    if (!activeSlice) {
      throw new Error(`No active compensation profile found for ${employeeId} at ${periodDate.toISOString()}`);
    }

    const { monthlyBaseSalary, taxRate, pensionRate, healthRate } = activeSlice.data;

    const grossPay = monthlyBaseSalary;
    const taxWithheld = Math.round(grossPay * taxRate);
    const pensionWithheld = Math.round(grossPay * pensionRate);
    const healthWithheld = Math.round(grossPay * healthRate);
    const totalDeductions = taxWithheld + pensionWithheld + healthWithheld;
    const netPay = grossPay - totalDeductions;

    return {
      employeeId,
      payPeriod: payPeriodLabel,
      grossPay,
      taxWithheld,
      pensionWithheld,
      healthWithheld,
      netPay,
    };
  }

  // Finance General Ledger Posting Service
  function postPayrollToGeneralLedger(slip: PayrollSlip): JournalEntry {
    // Double-Entry Balanced Payroll Accrual:
    // Debit: Salary & Wage Expense (6000-SALARY-EXP)
    // Credit: Tax Withholding Payable (2110-TAX-PAYABLE)
    // Credit: Pension Contribution Payable (2120-PENSION-PAYABLE)
    // Credit: Health Insurance Payable (2130-HEALTH-PAYABLE)
    // Credit: Net Salaries Payable (2100-NET-SALARIES)
    const lines: JournalLine[] = [
      { accountCode: "6000-SALARY-EXP", debit: slip.grossPay, credit: 0 },
      { accountCode: "2110-TAX-PAYABLE", debit: 0, credit: slip.taxWithheld },
      { accountCode: "2120-PENSION-PAYABLE", debit: 0, credit: slip.pensionWithheld },
      { accountCode: "2130-HEALTH-PAYABLE", debit: 0, credit: slip.healthWithheld },
      { accountCode: "2100-NET-SALARIES", debit: 0, credit: slip.netPay },
    ];

    // Verify strict parity
    const totalDebits = lines.reduce((s, l) => s + l.debit, 0);
    const totalCredits = lines.reduce((s, l) => s + l.credit, 0);
    expect(totalDebits).toBe(totalCredits);

    const je: JournalEntry = {
      id: `je-pr-${slip.employeeId}-${slip.payPeriod}`,
      tenantId,
      sourceDocId: `slip-${slip.employeeId}-${slip.payPeriod}`,
      description: `Payroll accrual for ${slip.employeeId} - ${slip.payPeriod}`,
      lines,
    };
    journalEntries.push(je);
    return je;
  }

  // Treasury Disbursement Service
  function disburseNetSalaries(slip: PayrollSlip): JournalEntry {
    // Debit: Net Salaries Payable (2100-NET-SALARIES)
    // Credit: Corporate Operating Bank Account (1000-CASH)
    const lines: JournalLine[] = [
      { accountCode: "2100-NET-SALARIES", debit: slip.netPay, credit: 0 },
      { accountCode: "1000-CASH", debit: 0, credit: slip.netPay },
    ];

    const je: JournalEntry = {
      id: `je-disburse-${slip.employeeId}-${slip.payPeriod}`,
      tenantId,
      sourceDocId: `slip-${slip.employeeId}-${slip.payPeriod}`,
      description: `Net salary direct deposit for ${slip.employeeId}`,
      lines,
    };
    journalEntries.push(je);
    return je;
  }

  it("calculates pre-promotion payroll accurately using temporal slice lookup (June 2026)", () => {
    // June 15, 2026: Pre-promotion base is $8,000
    const slipJune = calculateMonthlyPayroll("emp-701", new Date("2026-06-15"), "2026-06");

    expect(slipJune.grossPay).toBe(8000);
    expect(slipJune.taxWithheld).toBe(1760);       // 22% of 8000
    expect(slipJune.pensionWithheld).toBe(480);    // 6% of 8000
    expect(slipJune.healthWithheld).toBe(320);     // 4% of 8000
    expect(slipJune.netPay).toBe(5440);            // 8000 - 2560 = 5440

    // Post to General Ledger
    const je = postPayrollToGeneralLedger(slipJune);
    expect(je.lines[0].debit).toBe(8000);
    expect(je.lines[4].credit).toBe(5440);
  });

  it("automatically applies post-promotion raise using temporal slice lookup (July 2026)", () => {
    // July 15, 2026: Post-promotion base is $10,000
    const slipJuly = calculateMonthlyPayroll("emp-701", new Date("2026-07-15"), "2026-07");

    expect(slipJuly.grossPay).toBe(10000);
    expect(slipJuly.taxWithheld).toBe(2200);       // 22% of 10000
    expect(slipJuly.pensionWithheld).toBe(600);    // 6% of 10000
    expect(slipJuly.healthWithheld).toBe(400);     // 4% of 10000
    expect(slipJuly.netPay).toBe(6800);            // 10000 - 3200 = 6800

    // Post to General Ledger
    const jeAccrual = postPayrollToGeneralLedger(slipJuly);
    expect(jeAccrual.lines[0].debit).toBe(10000);

    // Disburse Payment
    const jeDisburse = disburseNetSalaries(slipJuly);
    expect(jeDisburse.lines[0].accountCode).toBe("2100-NET-SALARIES");
    expect(jeDisburse.lines[0].debit).toBe(6800);
    expect(jeDisburse.lines[1].accountCode).toBe("1000-CASH");
    expect(jeDisburse.lines[1].credit).toBe(6800);

    // Invariant: Net Salaries Payable is completely cleared
    const totalNetPayableDebits = journalEntries.reduce(
      (s, je) => s + (je.lines.find((l) => l.accountCode === "2100-NET-SALARIES")?.debit || 0),
      0
    );
    const totalNetPayableCredits = journalEntries.reduce(
      (s, je) => s + (je.lines.find((l) => l.accountCode === "2100-NET-SALARIES")?.credit || 0),
      0
    );
    expect(totalNetPayableDebits).toBe(totalNetPayableCredits); // 6800 === 6800
  });

  it("fails closed when payroll is requested for an unhired date before employee inception", () => {
    // Attempt to calculate payroll for 2025 before validFrom (2026-01-01)
    expect(() =>
      calculateMonthlyPayroll("emp-701", new Date("2025-11-15"), "2025-11")
    ).toThrow(/No active compensation profile/);

    expect(journalEntries.length).toBe(0);
  });
});
