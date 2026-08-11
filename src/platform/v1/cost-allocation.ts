/**
 * M27 — the allocation ARITHMETIC, isolated from any database call so it
 * can be unit-tested at 100% branch coverage per the exit criterion's own
 * DoD requirement. Every cent of every line item lands in exactly one of
 * `allocated` or `unallocated` — that invariant is what makes
 * `allocatedTotal + unallocatedTotal === ingestedTotal` true by
 * construction, not by a reconciliation step that could drift from it.
 */

export interface AllocationLineItem {
  lineItemId: string;
  /** Decimal string, e.g. "120.5000" — never a number. */
  amount: string;
  resourceId: string | null;
  sharedResourceIds: string[] | null;
}

export interface ResourceAttributionLookup {
  tenantId: string;
  service: string;
  environment: string;
}

/** Returns the attribution for a resource, or null if none exists or it
 *  is incomplete (M18's own "partial counts as unattributed" rule). */
export type AttributionLookupFn = (resourceId: string) => ResourceAttributionLookup | null;

export interface AllocatedShare {
  lineItemId: string;
  resourceId: string;
  tenantId: string;
  service: string;
  environment: string;
  /** Decimal string. */
  amount: string;
}

export interface UnallocatedShare {
  lineItemId: string;
  resourceId: string | null;
  reason: "no-resource-reference" | "incomplete-attribution";
  /** Decimal string. */
  amount: string;
}

export interface AllocationResult {
  allocated: AllocatedShare[];
  unallocated: UnallocatedShare[];
  /** Decimal strings — asserted to sum to `ingestedTotal` to the cent. */
  allocatedTotal: string;
  unallocatedTotal: string;
  ingestedTotal: string;
}

export function toCents(decimalString: string): bigint {
  const match = /^(-?)(\d+)(?:\.(\d{1,4}))?$/.exec(decimalString.trim());
  if (!match) throw new Error(`"${decimalString}" is not a valid decimal amount`);
  const [, sign, whole, fraction = ""] = match;
  // `whole` is always present when `match` succeeds — the regex's second
  // group, `(\d+)`, is not optional. TypeScript's `exec()` typing cannot
  // express that guarantee, so this is a type assertion, not a runtime
  // branch to cover.
  const paddedFraction = (fraction + "0000").slice(0, 4);
  const tenThousandths = BigInt(whole!) * 10000n + BigInt(paddedFraction);
  const cents = (tenThousandths + 50n) / 100n;
  return sign === "-" ? -cents : cents;
}

export function centsToDecimalString(cents: bigint): string {
  const negative = cents < 0n;
  const abs = negative ? -cents : cents;
  return `${negative ? "-" : ""}${abs / 100n}.${(abs % 100n).toString().padStart(2, "0")}00`;
}

/**
 * Splits `totalCents` into `count` whole-cent shares that sum EXACTLY
 * back to `totalCents` — the remainder (totalCents % count) is
 * distributed one cent at a time to the first `remainder` shares, so no
 * fractional cent is ever silently dropped or invented.
 */
function splitEvenly(totalCents: bigint, count: number): bigint[] {
  const base = totalCents / BigInt(count);
  const remainder = totalCents % BigInt(count);
  return Array.from({ length: count }, (_, i) => base + (BigInt(i) < remainder ? 1n : 0n));
}

export function allocateLineItems(lineItems: AllocationLineItem[], lookup: AttributionLookupFn): AllocationResult {
  const allocated: AllocatedShare[] = [];
  const unallocated: UnallocatedShare[] = [];
  let ingestedCents = 0n;

  for (const li of lineItems) {
    const lineCents = toCents(li.amount);
    ingestedCents += lineCents;

    if (li.resourceId) {
      const attribution = lookup(li.resourceId);
      if (attribution) {
        allocated.push({
          lineItemId: li.lineItemId,
          resourceId: li.resourceId,
          ...attribution,
          amount: centsToDecimalString(lineCents),
        });
      } else {
        unallocated.push({
          lineItemId: li.lineItemId,
          resourceId: li.resourceId,
          reason: "incomplete-attribution",
          amount: centsToDecimalString(lineCents),
        });
      }
      continue;
    }

    if (li.sharedResourceIds && li.sharedResourceIds.length > 0) {
      const shares = splitEvenly(lineCents, li.sharedResourceIds.length);
      li.sharedResourceIds.forEach((resourceId, i) => {
        const shareCents = shares[i]!;
        const attribution = lookup(resourceId);
        if (attribution) {
          allocated.push({
            lineItemId: li.lineItemId,
            resourceId,
            ...attribution,
            amount: centsToDecimalString(shareCents),
          });
        } else {
          unallocated.push({
            lineItemId: li.lineItemId,
            resourceId,
            reason: "incomplete-attribution",
            amount: centsToDecimalString(shareCents),
          });
        }
      });
      continue;
    }

    unallocated.push({
      lineItemId: li.lineItemId,
      resourceId: null,
      reason: "no-resource-reference",
      amount: centsToDecimalString(lineCents),
    });
  }

  const allocatedCents = allocated.reduce((sum, a) => sum + toCents(a.amount), 0n);
  const unallocatedCents = unallocated.reduce((sum, u) => sum + toCents(u.amount), 0n);

  return {
    allocated,
    unallocated,
    allocatedTotal: centsToDecimalString(allocatedCents),
    unallocatedTotal: centsToDecimalString(unallocatedCents),
    ingestedTotal: centsToDecimalString(ingestedCents),
  };
}
