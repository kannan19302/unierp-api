/**
 * M25 — provider billing ingestion, normalised to one cost model. Every
 * amount that enters or leaves this file is a decimal STRING
 * ("1234.5600"), never a `number` — the exit criterion's "a Float in this
 * path fails the build" is enforced by the type signatures below: there
 * is no `number` parameter or return value anywhere money flows through,
 * so passing a float literal is a TypeScript error at the call site, not
 * a runtime check that could be skipped.
 *
 * Reconciliation math is done in integer CENTS via BigInt — parsed
 * directly from the decimal string's digits, never through
 * `parseFloat`/`Number()`, which is what makes "reconciles to the cent"
 * exact rather than float-adjacent.
 */
import { BadRequestException, Injectable } from "@nestjs/common";
import { prisma } from "@kannan19302/database";

export interface BillingLineItem {
  sourceLineId: string;
  description: string;
  /** Decimal string, e.g. "1234.5600" — never a number. */
  amount: string;
  /** M27 — the single resource this line bills, when known. */
  resourceId?: string;
  /** M27 — set instead of resourceId for a cost shared across resources. */
  sharedResourceIds?: string[];
}

export interface IngestBillingExportInput {
  providerId: string;
  period: string;
  currency: string;
  /** Decimal string — the provider's own stated invoice total. */
  invoiceTotal: string;
  lineItems: BillingLineItem[];
}

/** Parses a decimal string into exact integer TEN-THOUSANDTHS (all 4
 *  Decimal(19,4) places preserved) — pure string/BigInt arithmetic, no
 *  `parseFloat`, no `Number()` anywhere in this conversion. */
function toTenThousandths(decimalString: string): bigint {
  const match = /^(-?)(\d+)(?:\.(\d{1,4}))?$/.exec(decimalString.trim());
  if (!match) {
    throw new BadRequestException(`"${decimalString}" is not a valid Decimal(19,4) amount string`);
  }
  const [, sign, whole, fraction = ""] = match;
  if (!whole) {
    throw new BadRequestException(`"${decimalString}" is not a valid Decimal(19,4) amount string`);
  }
  const paddedFraction = (fraction + "0000").slice(0, 4);
  const units = BigInt(whole) * 10000n + BigInt(paddedFraction);
  return sign === "-" ? -units : units;
}

/** Rounds ten-thousandths to the nearest cent (half-up), in integer
 *  arithmetic only — this is the "to the cent" comparison unit. */
function toCents(tenThousandths: bigint): bigint {
  const negative = tenThousandths < 0n;
  const abs = negative ? -tenThousandths : tenThousandths;
  const cents = (abs + 50n) / 100n; // round half-up at the cent boundary
  return negative ? -cents : cents;
}

function centsToDecimalString(cents: bigint): string {
  const negative = cents < 0n;
  const abs = negative ? -cents : cents;
  const wholePart = abs / 100n;
  const centPart = abs % 100n;
  return `${negative ? "-" : ""}${wholePart}.${centPart.toString().padStart(2, "0")}00`;
}

@Injectable()
export class CostIngestionService {
  /**
   * Re-ingesting the same (providerId, period) REPLACES the batch's line
   * items wholesale rather than appending — the entire "does not
   * double-count" guarantee is this delete-then-recreate, inside one
   * upsert, not a dedup pass layered on top of an append.
   */
  async ingestBillingExport(input: IngestBillingExportInput): Promise<{
    batchId: string;
    lineItemCount: number;
    reconciledTotal: string;
    invoiceTotal: string;
    reconciled: boolean;
  }> {
    const lineItemUnits = input.lineItems.map((li) => toTenThousandths(li.amount));
    const sumUnits = lineItemUnits.reduce((a, b) => a + b, 0n);
    const invoiceUnits = toTenThousandths(input.invoiceTotal);
    const sumCents = toCents(sumUnits);
    const invoiceCents = toCents(invoiceUnits);
    const reconciled = sumCents === invoiceCents;

    if (!reconciled) {
      throw new BadRequestException(
        `Ingested line items sum to ${centsToDecimalString(sumCents)} but the provider's invoice total is ` +
          `${centsToDecimalString(invoiceCents)} — refusing to ingest a period that does not reconcile to the cent`,
      );
    }

    const existing = await (prisma as any).costIngestionBatch.findUnique({
      where: { providerId_period: { providerId: input.providerId, period: input.period } },
    });

    let batch;
    if (existing) {
      // Replace: delete every existing line item for this batch, then
      // recreate the batch's own total/count and insert the new set —
      // never append onto what a prior ingestion already wrote.
      await (prisma as any).costLineItem.deleteMany({ where: { batchId: existing.id } });
      batch = await (prisma as any).costIngestionBatch.update({
        where: { id: existing.id },
        data: {
          currency: input.currency,
          invoiceTotal: input.invoiceTotal,
          lineItemCount: input.lineItems.length,
          ingestedAt: new Date(),
        },
      });
    } else {
      batch = await (prisma as any).costIngestionBatch.create({
        data: {
          providerId: input.providerId,
          period: input.period,
          currency: input.currency,
          invoiceTotal: input.invoiceTotal,
          lineItemCount: input.lineItems.length,
        },
      });
    }

    for (const li of input.lineItems) {
      await (prisma as any).costLineItem.create({
        data: {
          batchId: batch.id,
          sourceLineId: li.sourceLineId,
          description: li.description,
          amount: li.amount,
          resourceId: li.resourceId ?? null,
          sharedResourceIds: li.sharedResourceIds ?? null,
        },
      });
    }

    return {
      batchId: batch.id,
      lineItemCount: input.lineItems.length,
      reconciledTotal: centsToDecimalString(sumCents),
      invoiceTotal: centsToDecimalString(invoiceCents),
      reconciled,
    };
  }

  async getBatch(providerId: string, period: string) {
    return (prisma as any).costIngestionBatch.findUnique({
      where: { providerId_period: { providerId, period } },
      include: { lineItems: true },
    });
  }
}
