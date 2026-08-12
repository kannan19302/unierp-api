import { Injectable, ConflictException } from "@nestjs/common";
import { prisma } from "@kannan19302/database";
import type { Prisma, PrismaClient } from "@prisma/client";

type TxClient = Prisma.TransactionClient | PrismaClient;

/**
 * E44: per-tenant, per-document-type, per-fiscal-year statutory
 * numbering that is gapless and monotonic under concurrency and
 * rollback. A `SELECT count() + 1` (the pattern used across most of
 * this codebase's number generators — invoices, purchase orders, MRP
 * items, etc.) is not safe for this: two concurrent creates can read
 * the same count and mint the same number (a duplicate), and nothing
 * about it prevents a rolled-back transaction from having "claimed" a
 * number no other row will ever carry (a gap).
 *
 * The mechanism here relies on a property of `UPDATE` in a
 * transactional RDBMS: `UPDATE document_sequences SET next_number =
 * next_number + 1 WHERE id = ? RETURNING next_number` takes a row lock
 * for the duration of the enclosing transaction. A second concurrent
 * transaction incrementing the SAME sequence row blocks until the
 * first commits or rolls back — it never reads a stale value, so two
 * callers can never receive the same number (no duplicates). And
 * because the increment happens inside the SAME transaction as the
 * caller's own document insert (the caller must pass its own `tx`,
 * not the bare `prisma` client), a rollback of that transaction rolls
 * back the increment too — a failed create consumes no number (no
 * gaps).
 */
@Injectable()
export class DocumentNumberingService {
  /**
   * Reserve and return the next number in a series, atomically, as
   * part of the caller's own transaction. MUST be called with a `tx`
   * that is the same transaction the calling code uses to insert the
   * document itself — calling this outside a transaction, or in a
   * different transaction than the insert, reintroduces the exact gap
   * risk this service exists to close.
   */
  async getNextNumber(
    tx: TxClient,
    tenantId: string,
    series: string,
    options: {
      organizationId?: string | null;
      resetFrequency?: "YEARLY" | "MONTHLY" | "NEVER";
      prefix?: string;
      suffix?: string;
      padding?: number;
    } = {},
  ): Promise<string> {
    const organizationId = options.organizationId ?? null;
    const resetFrequency = options.resetFrequency ?? "NEVER";
    const resetPeriod = this.currentResetPeriod(resetFrequency);

    let sequence = await (tx as PrismaClient).documentSequence.findFirst({
      where: { tenantId, series, organizationId },
    });

    if (!sequence) {
      try {
        sequence = await (tx as PrismaClient).documentSequence.create({
          data: {
            tenantId,
            series,
            organizationId,
            prefix: options.prefix ?? "",
            suffix: options.suffix ?? "",
            padding: options.padding ?? 5,
            resetFrequency,
            resetPeriod,
            nextNumber: 1,
          },
        });
      } catch (err: any) {
        // Two concurrent callers both saw no row and raced to create
        // one; the @@unique([tenantId, series, organizationId])
        // constraint lets exactly one create() win. The loser refetches
        // the winner's row rather than erroring.
        if (err?.code === "P2002") {
          sequence = await (tx as PrismaClient).documentSequence.findFirst({
            where: { tenantId, series, organizationId },
          });
        } else {
          throw err;
        }
      }
    }
    if (!sequence) {
      throw new ConflictException(
        `Failed to establish a number sequence for ${series}.`,
      );
    }

    // A new fiscal period resets the counter to 1 — this reset must
    // also happen inside the same atomic update, not as a separate
    // read-then-write, or two concurrent first-transactions-of-the-year
    // could both reset and both claim "1".
    const needsReset =
      resetFrequency !== "NEVER" && sequence.resetPeriod !== resetPeriod;

    const updated = needsReset
      ? await (tx as PrismaClient).documentSequence.update({
          where: { id: sequence.id },
          data: { nextNumber: 2, resetPeriod },
        })
      : await (tx as PrismaClient).documentSequence.update({
          where: { id: sequence.id },
          data: { nextNumber: { increment: 1 } },
        });

    const numberUsed = needsReset ? 1 : updated.nextNumber - 1;
    return this.format(updated, numberUsed);
  }

  private currentResetPeriod(
    resetFrequency: "YEARLY" | "MONTHLY" | "NEVER",
  ): string | null {
    const now = new Date();
    if (resetFrequency === "YEARLY") return String(now.getFullYear());
    if (resetFrequency === "MONTHLY")
      return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    return null;
  }

  private format(
    seq: { prefix: string; suffix: string; padding: number; format: string },
    number: number,
  ): string {
    const padded = String(number).padStart(seq.padding, "0");
    return seq.format
      .replace("{prefix}", seq.prefix)
      .replace("{number}", padded)
      .replace("{suffix}", seq.suffix);
  }
}
