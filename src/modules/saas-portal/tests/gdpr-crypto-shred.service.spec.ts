/**
 * D11 exit criterion: "An erasure request removes personal data while
 * preserving the audit trail's integrity, by a documented mechanism
 * (crypto-shredding or tokenised redaction). The resolution is written
 * down, not implicit (G-3)."
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

let keys: any[];
let seq = 0;

vi.mock("@kannan19302/database", () => ({
  prisma: {
    subjectErasureKey: {
      findUnique: vi.fn(({ where }: any) => {
        const { tenantId, subjectEmailHash } = where.tenantId_subjectEmailHash;
        return keys.find((k) => k.tenantId === tenantId && k.subjectEmailHash === subjectEmailHash) ?? null;
      }),
      create: vi.fn(({ data }: any) => { const row = { id: `key-${++seq}`, createdAt: new Date(), ...data }; keys.push(row); return row; }),
      deleteMany: vi.fn(({ where }: any) => {
        const before = keys.length;
        const remaining = keys.filter((k) => !(k.tenantId === where.tenantId && k.subjectEmailHash === where.subjectEmailHash));
        const removed = before - remaining.length;
        keys.length = 0;
        keys.push(...remaining);
        return { count: removed };
      }),
    },
  },
}));

import { GdprCryptoShredService } from "../services/gdpr-crypto-shred.service";

describe("D11 · crypto-shredding — the documented, working resolution to erasure vs. immutable audit", () => {
  let shred: GdprCryptoShredService;

  beforeEach(() => {
    vi.clearAllMocks();
    keys = [];
    seq = 0;
    shred = new GdprCryptoShredService();
  });

  it("ENCRYPTS a personal-data reference and DECRYPTS it back while the key exists", async () => {
    const ciphertext = await shred.encryptForAudit("t1", "subject@example.com", "subject@example.com");
    expect(ciphertext).not.toContain("subject@example.com"); // never plaintext at rest

    const decrypted = await shred.decryptForAudit("t1", "subject@example.com", ciphertext);
    expect(decrypted).toBe("subject@example.com");
  });

  it("SHREDDING makes the SAME ciphertext PERMANENTLY unrecoverable — the audit-trail entry itself is never touched", async () => {
    const ciphertext = await shred.encryptForAudit("t1", "subject@example.com", "subject@example.com");

    await shred.shred("t1", "subject@example.com");

    // The ciphertext (already written into an audit-trail row, in a real
    // caller) is untouched — this proves it, by trying to decrypt the
    // EXACT SAME bytes again after the key is gone.
    await expect(shred.decryptForAudit("t1", "subject@example.com", ciphertext)).rejects.toThrow(/shredded/);
  });

  it("shredding one subject's key never affects a DIFFERENT subject's key", async () => {
    const ciphertextA = await shred.encryptForAudit("t1", "alice@example.com", "alice@example.com");
    const ciphertextB = await shred.encryptForAudit("t1", "bob@example.com", "bob@example.com");

    await shred.shred("t1", "alice@example.com");

    await expect(shred.decryptForAudit("t1", "alice@example.com", ciphertextA)).rejects.toThrow(/shredded/);
    await expect(shred.decryptForAudit("t1", "bob@example.com", ciphertextB)).resolves.toBe("bob@example.com");
  });

  it("the SAME tenant/subject reuses the SAME key across multiple encryptions — one key per subject, not one per call", async () => {
    await shred.encryptForAudit("t1", "subject@example.com", "first reference");
    await shred.encryptForAudit("t1", "subject@example.com", "second reference");
    expect(keys).toHaveLength(1);
  });

  it("shredding a tenant's key never affects a DIFFERENT tenant's key for the same email", async () => {
    const ciphertextT1 = await shred.encryptForAudit("t1", "shared@example.com", "shared@example.com");
    const ciphertextT2 = await shred.encryptForAudit("t2", "shared@example.com", "shared@example.com");

    await shred.shred("t1", "shared@example.com");

    await expect(shred.decryptForAudit("t1", "shared@example.com", ciphertextT1)).rejects.toThrow(/shredded/);
    await expect(shred.decryptForAudit("t2", "shared@example.com", ciphertextT2)).resolves.toBe("shared@example.com");
  });
});
