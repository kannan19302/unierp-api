import { Injectable, ForbiddenException } from "@nestjs/common";
import { randomBytes, createCipheriv, createDecipheriv, scryptSync } from "node:crypto";

/**
 * E20 — "PII encrypted per A25." A25 itself claims "every one of the 21
 * models the PII gate found undeclared... is encrypted or has a logged
 * exemption," but no encryption mechanism touching `Employee.bankDetails`
 * (a `Json?` column holding account/routing numbers) exists anywhere in
 * this checkout, and no encryption-specific gate script exists to have
 * ever verified that claim (filed as a defect — see 90-DEFECT-LOG.md).
 *
 * This service closes the gap for the one field with no legitimate reason
 * to be server-side queryable in plaintext: `bankDetails`.
 * `dateOfBirth` is deliberately NOT encrypted here — `hr.service.ts`
 * queries it directly for upcoming-birthday reporting, so encrypting it
 * would require searchable/deterministic encryption or a decrypt-then-
 * filter rewrite of that feature, which is a larger, separately-scoped
 * change, stated as a gap rather than silently left plaintext without
 * comment.
 *
 * The key is DERIVED per tenant from a server-side master secret
 * (PII_ENCRYPTION_MASTER_KEY) via scrypt — nothing is stored in the
 * database, so no schema migration is needed (none is available in this
 * checkout; the schema lives in the separate `@unerp/database` package).
 */
const ALGORITHM = "aes-256-gcm";

function getMasterKey(): string {
  const key = process.env.PII_ENCRYPTION_MASTER_KEY;
  if (key) return key;
  // No master key configured: a fixed, clearly-marked fallback so tests
  // and local dev are still deterministic — NEVER acceptable in
  // production, where PII_ENCRYPTION_MASTER_KEY must be set.
  return "INSECURE-DEV-FALLBACK-DO-NOT-USE-IN-PRODUCTION";
}

interface EncryptedEnvelope {
  __encrypted: true;
  ciphertext: string;
  iv: string;
  authTag: string;
  tenantId: string;
}

@Injectable()
export class EmployeePiiEncryptionService {
  private deriveTenantKey(tenantId: string): Buffer {
    return scryptSync(`${getMasterKey()}:${tenantId}`, "employee-pii-v1", 32);
  }

  encryptBankDetails(tenantId: string, bankDetails: unknown): EncryptedEnvelope | undefined {
    if (bankDetails === undefined || bankDetails === null) return undefined;
    const key = this.deriveTenantKey(tenantId);
    const iv = randomBytes(12);
    const cipher = createCipheriv(ALGORITHM, key, iv);
    const plaintext = JSON.stringify(bankDetails);
    const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    return {
      __encrypted: true,
      ciphertext: ciphertext.toString("base64"),
      iv: iv.toString("base64"),
      authTag: cipher.getAuthTag().toString("base64"),
      tenantId,
    };
  }

  decryptBankDetails(tenantId: string, envelope: EncryptedEnvelope | undefined): unknown {
    if (envelope === undefined || envelope === null) return undefined;
    if (envelope.tenantId !== tenantId) {
      throw new ForbiddenException(
        `Bank-details envelope belongs to tenant "${envelope.tenantId}", not "${tenantId}" — refusing cross-tenant decryption.`,
      );
    }
    const key = this.deriveTenantKey(tenantId);
    const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(envelope.iv, "base64"));
    decipher.setAuthTag(Buffer.from(envelope.authTag, "base64"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, "base64")),
      decipher.final(),
    ]).toString("utf8");
    return JSON.parse(plaintext);
  }
}
