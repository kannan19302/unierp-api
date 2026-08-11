/**
 * D11 — the WRITTEN-DOWN resolution to the erasure-versus-immutable-audit
 * conflict (G-3). See SubjectErasureKey's own schema comment
 * (unierp-data/prisma/schema/core-part-5.prisma) for the full rationale;
 * summarized here:
 *
 *   The audit trail is append-only and is NEVER mutated or deleted by an
 *   erasure — its integrity is preserved by never touching it. Any
 *   personal-data reference that must be written INTO the audit trail as
 *   part of processing an erasure (e.g. the GDPR_ERASURE audit log entry
 *   itself, which would otherwise recreate the very email address it just
 *   erased in plaintext) is encrypted under a per-subject key BEFORE being
 *   stored. shred() deletes that key — nowhere else does it exist — so
 *   every audit-trail ciphertext encrypted under it becomes permanently
 *   unrecoverable from that instant, without altering a single byte of the
 *   audit log itself. This is crypto-shredding, one of the two mechanisms
 *   the exit criterion names, applied narrowly to the one place personal
 *   data genuinely enters the audit trail.
 */
import { Injectable } from "@nestjs/common";
import { randomBytes, createHash, createCipheriv, createDecipheriv } from "node:crypto";
import { prisma } from "@kannan19302/database";

const ALGORITHM = "aes-256-gcm";

function hashSubject(email: string): string {
  return createHash("sha256").update(email.trim().toLowerCase()).digest("hex");
}

@Injectable()
export class GdprCryptoShredService {
  private async getOrCreateKey(tenantId: string, email: string): Promise<Buffer> {
    const subjectEmailHash = hashSubject(email);
    const existing = await (prisma as any).subjectErasureKey.findUnique({
      where: { tenantId_subjectEmailHash: { tenantId, subjectEmailHash } },
    });
    if (existing) return Buffer.from(existing.encryptionKey, "base64");

    const key = randomBytes(32);
    await (prisma as any).subjectErasureKey.create({
      data: { tenantId, subjectEmailHash, encryptionKey: key.toString("base64") },
    });
    return key;
  }

  /** Encrypts `plaintext` under the subject's own key, creating one if
   *  none exists yet — used BEFORE any personal-data reference is written
   *  into an audit-trail entry. */
  async encryptForAudit(tenantId: string, email: string, plaintext: string): Promise<string> {
    const key = await this.getOrCreateKey(tenantId, email);
    const iv = randomBytes(12);
    const cipher = createCipheriv(ALGORITHM, key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return Buffer.concat([iv, authTag, encrypted]).toString("base64");
  }

  /** Decrypts a ciphertext produced by encryptForAudit — throws once the
   *  subject's key has been shredded, by construction (the key no longer
   *  exists to decrypt with), proving erasure without touching the
   *  ciphertext's own audit-log row. */
  async decryptForAudit(tenantId: string, email: string, ciphertext: string): Promise<string> {
    const subjectEmailHash = hashSubject(email);
    const row = await (prisma as any).subjectErasureKey.findUnique({
      where: { tenantId_subjectEmailHash: { tenantId, subjectEmailHash } },
    });
    if (!row) {
      throw new Error("Subject erasure key has been shredded — this reference is permanently unrecoverable");
    }
    const key = Buffer.from(row.encryptionKey, "base64");
    const raw = Buffer.from(ciphertext, "base64");
    const iv = raw.subarray(0, 12);
    const authTag = raw.subarray(12, 28);
    const encrypted = raw.subarray(28);
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
  }

  /**
   * Deletes the subject's key. Every audit-trail ciphertext encrypted
   * under it — already written, already part of the immutable log — is
   * unrecoverable from this instant onward. The audit log rows
   * themselves are never touched.
   */
  async shred(tenantId: string, email: string): Promise<void> {
    const subjectEmailHash = hashSubject(email);
    await (prisma as any).subjectErasureKey.deleteMany({ where: { tenantId, subjectEmailHash } });
  }
}
