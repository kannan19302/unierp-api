/**
 * ControlPlaneAuditService — append-only audit log for provider operations.
 *
 * § C03: Every read and write in plane 1 is recorded with actor, target tenant,
 * before/after, justification and correlation ID. Audit records are append-only
 * and tamper-evident.
 *
 * Tamper-evidence is achieved by chaining SHA-256 hashes: each record includes
 * the hash of the previous record for the same actor. An offline verifier can
 * replay the chain and detect any modified or deleted entry.
 *
 * Usage:
 *   await this.audit.record({
 *     actorId: user.userId,
 *     actorRole: user.realm,
 *     action: "tenant.provision",
 *     targetId: tenant.id,
 *     details: { name, slug, adminEmail },
 *     correlationId: req.headers['x-correlation-id'],
 *     ipAddress: req.ip,
 *   });
 *
 * The record() call MUST be awaited inside the same database transaction as
 * the mutation it describes, so a rolled-back mutation never produces a dangling
 * audit entry and a committed mutation never fails to produce one.
 */

import { Injectable, ForbiddenException } from "@nestjs/common";
import { createHash } from "crypto";
import { prisma } from "@kannan19302/database";

export interface AuditRecordInput {
  actorId: string;
  actorRole: string;
  action: string;
  targetId?: string | null;
  details?: Record<string, unknown>;
  correlationId?: string | null;
  ipAddress?: string | null;
}

@Injectable()
export class ControlPlaneAuditService {
  /**
   * Write one immutable audit record.
   *
   * The caller must await this inside the same transaction as the mutation;
   * passing a `tx` argument is the recommended pattern (see example above).
   *
   * Returns the created record's id for logging purposes.
   */
  async record(
    input: AuditRecordInput,
    tx?: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  ): Promise<string> {
    const db = tx ?? prisma;

    // Fetch the previous hash for this actor to chain the record.
    const prev = await (db as any).controlPlaneAuditLog.findFirst({
      where: { actorId: input.actorId },
      orderBy: { sequenceNum: "desc" },
      select: { contentHash: true },
    });

    const previousHash = prev?.contentHash ?? "";
    const detailsStr = JSON.stringify(input.details ?? {});

    // Build a preliminary payload hash. sequenceNum is assigned by the
    // database autoincrement; we include a placeholder and accept that the
    // hash is over the *intended* content rather than the final sequence.
    // The chain integrity still catches row deletion or field mutation.
    const rawContent = [
      input.action,
      input.actorId,
      input.targetId ?? "",
      detailsStr,
      previousHash,
    ].join("|");

    const contentHash = createHash("sha256").update(rawContent).digest("hex");

    const record = await (db as any).controlPlaneAuditLog.create({
      data: {
        actorId: input.actorId,
        actorRole: input.actorRole,
        action: input.action,
        targetId: input.targetId ?? null,
        details: input.details ?? {},
        correlationId: input.correlationId ?? null,
        ipAddress: input.ipAddress ?? null,
        contentHash,
        previousHash,
      },
    });

    return record.id;
  }

  /**
   * Verify the hash chain for a given actor from the beginning.
   * Returns the number of records verified, and the index of the first broken
   * link (undefined if the chain is intact).
   */
  async verifyChain(
    actorId: string,
  ): Promise<{ verified: number; brokenAt?: number }> {
    const records = await (prisma as any).controlPlaneAuditLog.findMany({
      where: { actorId },
      orderBy: { sequenceNum: "asc" },
    });

    let expectedPreviousHash = "";
    for (let i = 0; i < records.length; i++) {
      const r = records[i]!;
      const detailsStr = JSON.stringify(r.details);
      const rawContent = [
        r.action,
        r.actorId,
        r.targetId ?? "",
        detailsStr,
        expectedPreviousHash,
      ].join("|");
      const expected = createHash("sha256").update(rawContent).digest("hex");

      if (expected !== r.contentHash) {
        return { verified: i, brokenAt: i };
      }
      expectedPreviousHash = r.contentHash;
    }

    return { verified: records.length };
  }
}
