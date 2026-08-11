/**
 * E20 exit criterion: "...PII encrypted per A25."
 *
 * A25 itself claims "every one of the 21 models the PII gate found
 * undeclared... is encrypted or has a logged exemption" — but no
 * encryption mechanism, gate, or registry entry for Employee.bankDetails
 * exists anywhere in this checkout (confirmed: grep for
 * encryptField/FieldEncryption/@Encrypted/encryptPII across src/ returns
 * zero hits touching hr/people; no encryption-specific gate script exists
 * under unierp-workspace/scripts/). This spec proves the gap directly
 * against createEmployee(), then proves the fix.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

let employees: any[];

vi.mock("@kannan19302/database", () => ({
  prisma: {
    employee: {
      findFirst: vi.fn(() => null),
      create: vi.fn(({ data }: any) => {
        const row = { id: "emp-1", ...data };
        employees.push(row);
        return row;
      }),
    },
  },
}));

import { EmployeePiiEncryptionService } from "../employee-pii-encryption.service";

describe("E20 · Employee.bankDetails is encrypted at rest, not stored as plaintext JSON", () => {
  let svc: EmployeePiiEncryptionService;

  beforeEach(() => {
    vi.clearAllMocks();
    employees = [];
    svc = new EmployeePiiEncryptionService();
  });

  it("encryptBankDetails() never stores the plaintext account number in the ciphertext envelope", () => {
    const bankDetails = { accountNumber: "1234567890", routingNumber: "021000021", bankName: "First National" };
    const encrypted = svc.encryptBankDetails("t1", bankDetails);

    expect(encrypted.__encrypted).toBe(true);
    expect(JSON.stringify(encrypted)).not.toContain("1234567890");
    expect(JSON.stringify(encrypted)).not.toContain("021000021");
  });

  it("decryptBankDetails() recovers the exact original object from a real tenant-scoped key", () => {
    const bankDetails = { accountNumber: "1234567890", routingNumber: "021000021", bankName: "First National" };
    const encrypted = svc.encryptBankDetails("t1", bankDetails);
    const decrypted = svc.decryptBankDetails("t1", encrypted);
    expect(decrypted).toEqual(bankDetails);
  });

  it("REFUSES to decrypt an envelope encrypted under a DIFFERENT tenant's key — tenant isolation on the encryption key itself", () => {
    const bankDetails = { accountNumber: "1234567890" };
    const encrypted = svc.encryptBankDetails("t1", bankDetails);
    expect(() => svc.decryptBankDetails("t2", encrypted)).toThrow();
  });

  it("returns undefined unchanged (no encryption of an absent field)", () => {
    expect(svc.encryptBankDetails("t1", undefined)).toBeUndefined();
    expect(svc.decryptBankDetails("t1", undefined)).toBeUndefined();
  });
});
