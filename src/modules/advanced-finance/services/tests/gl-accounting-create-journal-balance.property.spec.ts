/**
 * J10 exit criterion: "Each invariant ... has a property test that has
 * found at least one real edge case, recorded." Invariant: "a ledger
 * always balances."
 *
 * GlAccountingService.postJournalToBook() was already fixed (see
 * gl-accounting-balance-check.service.spec.ts, E09) to use exact Decimal
 * arithmetic instead of `Math.abs(totalDebit - totalCredit) > 0.01`. The
 * SIBLING method GlAccountingService.createJournal() still has the exact
 * same float-summation-with-epsilon-tolerance pattern:
 *
 *   const debits = dto.entries.reduce((sum, e) => sum + e.debit, 0);
 *   const credits = dto.entries.reduce((sum, e) => sum + e.credit, 0);
 *   if (Math.abs(debits - credits) > 0.01) throw ...
 *
 * The `Math.abs(...) > 0.01` epsilon is not float noise from summation —
 * it is a designed tolerance that accepts ANY imbalance up to a full cent
 * as "close enough." Property-based generation searches the input space
 * for genuinely unbalanced journals (a real Decimal(19,4)-precision
 * mismatch strictly greater than zero and at most one cent) and proves
 * this check WRONGLY ACCEPTS them — the exact same class of bug already
 * found and fixed in the sibling method postJournalToBook() (E09), never
 * fixed here.
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { Prisma } from "@prisma/client";

/**
 * The ORIGINAL (pre-fix) balance check from GlAccountingService.
 * createJournal(), isolated so fast-check can search it directly. Kept
 * here, not deleted, as the recorded FAIL-first proof this edge case is
 * real — J10's exit criterion asks for the edge case to be "recorded,"
 * not merely fixed and forgotten.
 */
function isBalancedByOriginalFloatCheck(
  entries: Array<{ debit: number; credit: number }>,
): boolean {
  const debits = entries.reduce((sum, e) => sum + e.debit, 0);
  const credits = entries.reduce((sum, e) => sum + e.credit, 0);
  return Math.abs(debits - credits) <= 0.01;
}

/**
 * The FIXED balance check (D122): exact Decimal arithmetic, mirroring
 * gl-accounting.service.ts's createJournal() after this phase's fix.
 */
function isBalancedByFixedDecimalCheck(
  entries: Array<{ debit: number; credit: number }>,
): boolean {
  const debits = entries.reduce(
    (sum, e) => sum.add(new Prisma.Decimal(e.debit)),
    new Prisma.Decimal(0),
  );
  const credits = entries.reduce(
    (sum, e) => sum.add(new Prisma.Decimal(e.credit)),
    new Prisma.Decimal(0),
  );
  return debits.equals(credits);
}

/** The ground truth: exact decimal-cent arithmetic, immune to float drift. */
function isTrulyBalanced(entries: Array<{ debit: number; credit: number }>): boolean {
  const toCents = (n: number) => Math.round(n * 10000); // Decimal(19,4) precision
  const debitCents = entries.reduce((sum, e) => sum + toCents(e.debit), 0);
  const creditCents = entries.reduce((sum, e) => sum + toCents(e.credit), 0);
  return debitCents === creditCents;
}

function nearMissImbalancedEntries(rawAmount: number, rawImbalance: number) {
  const amount = Math.round(rawAmount * 10000) / 10000;
  // A genuine discrepancy strictly greater than 0 and at most one cent —
  // real, wrong money at Decimal(19,4) precision, not float noise.
  const imbalance = Math.max(
    0.0001,
    Math.min(0.01, Math.round(rawImbalance * 10000) / 10000),
  );
  const debit = amount;
  const credit = Math.round((amount - imbalance) * 10000) / 10000;
  return [
    { accountId: "acc-1", debit, credit: 0 },
    { accountId: "acc-2", debit: 0, credit },
  ];
}

const nearMissAmounts = [
  fc.float({ min: Math.fround(1), max: Math.fround(1000000), noNaN: true }),
  fc.float({ min: Math.fround(0.0001), max: Math.fround(0.01), noNaN: true }),
] as const;

describe("J10 · ledger-balances invariant — GlAccountingService.createJournal()'s balance check", () => {
  it("D122, FAIL-first: the ORIGINAL float-epsilon check WRONGLY ACCEPTS a genuinely unbalanced journal", () => {
    const counterexample = fc.check(
      fc.property(...nearMissAmounts, (rawAmount, rawImbalance) => {
        const entries = nearMissImbalancedEntries(rawAmount, rawImbalance);
        const trulyBalanced = isTrulyBalanced(entries);
        const passesCheck = isBalancedByOriginalFloatCheck(entries);
        // Invariant: a genuinely UNBALANCED journal must never pass the
        // balance check. Violated here on purpose — this documents the
        // real edge case fast-check found against the pre-fix code.
        return trulyBalanced || !passesCheck;
      }),
      { numRuns: 500, seed: 42 },
    );

    // Record the found edge case for J10's exit criterion ("has found at
    // least one real edge case, recorded").
     
    console.log(
      "J10/D122 edge case found: the ORIGINAL createJournal() float-epsilon " +
        "balance check accepted this genuinely unbalanced [debit, credit] " +
        "pair as balanced:",
      JSON.stringify(counterexample.counterexample),
    );

    expect(counterexample.failed).toBe(true);
  });

  it("D122, PASS after fix: the exact-Decimal check REJECTS every unbalanced journal fast-check can construct", () => {
    fc.assert(
      fc.property(...nearMissAmounts, (rawAmount, rawImbalance) => {
        const entries = nearMissImbalancedEntries(rawAmount, rawImbalance);
        const trulyBalanced = isTrulyBalanced(entries);
        const passesCheck = isBalancedByFixedDecimalCheck(entries);
        return trulyBalanced || !passesCheck;
      }),
      { numRuns: 500, seed: 42 },
    );
  });
});
