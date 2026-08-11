/**
 * M35 — SLA credit arithmetic, isolated from any database call so it can
 * be unit-tested at 100% branch coverage per the exit criterion's own
 * requirement (the same discipline M27's cost-allocation.ts used for
 * the same reason). Money is a decimal STRING throughout — never a
 * `number` parameter or return value — and the tier lookup and
 * percentage arithmetic run in integer basis points via BigInt, never a
 * float.
 */

export interface CreditTier {
  /** Actual uptime strictly below this percent, expressed in basis
   *  points of a percent (e.g. 9990 = 99.90%), qualifies for this
   *  tier's credit. Tiers are checked in the order given; the FIRST
   *  matching tier applies. */
  belowPercentBps: number;
  /** Credit as a fraction of the monthly fee, in basis points (e.g. 5000
   *  = 50%). */
  creditBps: number;
}

/** A conventional SLA credit schedule: the worse the breach, the larger
 *  the credit, and a breach that still clears 99.9% earns nothing. */
export const DEFAULT_CREDIT_TIERS: CreditTier[] = [
  { belowPercentBps: 9500, creditBps: 5000 }, // <95.00% -> 50%
  { belowPercentBps: 9900, creditBps: 2500 }, // <99.00% -> 25%
  { belowPercentBps: 9990, creditBps: 1000 }, // <99.90% -> 10%
];

function toCents(decimalString: string): bigint {
  const match = /^(-?)(\d+)(?:\.(\d{1,4}))?$/.exec(decimalString.trim());
  if (!match) throw new Error(`"${decimalString}" is not a valid decimal amount`);
  const [, sign, whole, fraction = ""] = match;
  const tenThousandths = BigInt(whole!) * 10000n + BigInt((fraction + "0000").slice(0, 4));
  const cents = (tenThousandths + 50n) / 100n;
  return sign === "-" ? -cents : cents;
}

function centsToDecimalString(cents: bigint): string {
  const negative = cents < 0n;
  const abs = negative ? -cents : cents;
  return `${negative ? "-" : ""}${abs / 100n}.${(abs % 100n).toString().padStart(2, "0")}00`;
}

/**
 * `actualPercent` is a plain number (a measured uptime percentage, e.g.
 * 98.5) — the ONE place this file accepts a float, because it is a
 * measurement, not money; every money value from here on is a decimal
 * string computed via BigInt cents.
 */
export function calculateSlaCredit(actualPercent: number, monthlyFee: string, tiers: CreditTier[] = DEFAULT_CREDIT_TIERS): {
  creditAmount: string;
  creditBps: number;
  tierApplied: CreditTier | null;
} {
  const actualBps = Math.round(actualPercent * 100);
  const tier = tiers.find((t) => actualBps < t.belowPercentBps) ?? null;

  if (!tier) {
    return { creditAmount: "0.0000", creditBps: 0, tierApplied: null };
  }

  const feeCents = toCents(monthlyFee);
  const creditCents = (feeCents * BigInt(tier.creditBps) + 5000n) / 10000n; // round half-up

  return { creditAmount: centsToDecimalString(creditCents), creditBps: tier.creditBps, tierApplied: tier };
}
