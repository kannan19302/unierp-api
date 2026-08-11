/**
 * E20 exit criterion: "...PII encrypted per A25." Proves HrService's
 * createEmployee/updateEmployee actually encrypt bankDetails before
 * writing, and getEmployeeBankDetails decrypts correctly — not just that
 * EmployeePiiEncryptionService works in isolation (already proven in
 * employee-pii-encryption.service.spec.ts).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

let employees: any[];

vi.mock("@kannan19302/database", () => ({
  prisma: {
    employee: {
      findFirst: vi.fn(({ where }: any) => employees.find((e) => e.id === where.id || e.employeeCode === where.employeeCode) ?? null),
      create: vi.fn(({ data }: any) => {
        const row = { id: "emp-1", deletedAt: null, ...data };
        employees.push(row);
        return row;
      }),
      update: vi.fn(({ where, data }: any) => {
        const row = employees.find((e) => e.id === where.id);
        Object.assign(row, data);
        return row;
      }),
    },
  },
}));

import { HrService } from "../hr.service";
import { EmployeePiiEncryptionService } from "../employee-pii-encryption.service";

describe("E20 · HrService is wired to encrypt bankDetails, not store it plaintext", () => {
  let service: HrService;

  beforeEach(() => {
    vi.clearAllMocks();
    employees = [];
    service = new HrService(undefined, new EmployeePiiEncryptionService());
  });

  it("createEmployee never stores the plaintext account number in the database row", async () => {
    const employee = await service.createEmployee("t1", "org1", {
      employeeCode: "E001",
      firstName: "Jane",
      lastName: "Doe",
      email: "jane@example.com",
      bankDetails: { accountNumber: "9876543210", bankName: "Test Bank" },
    });

    expect(JSON.stringify(employee.bankDetails)).not.toContain("9876543210");
    expect((employee.bankDetails as any).__encrypted).toBe(true);
  });

  it("getEmployeeBankDetails decrypts the stored ciphertext back to the real account number", async () => {
    const employee = await service.createEmployee("t1", "org1", {
      employeeCode: "E002",
      firstName: "John",
      lastName: "Smith",
      email: "john@example.com",
      bankDetails: { accountNumber: "1111222233", bankName: "Other Bank" },
    });

    const decrypted: any = await service.getEmployeeBankDetails("t1", employee.id);
    expect(decrypted.accountNumber).toBe("1111222233");
  });

  it("updateEmployee also encrypts a new bankDetails value, not stores it plaintext", async () => {
    const employee = await service.createEmployee("t1", "org1", {
      employeeCode: "E003",
      firstName: "Ann",
      lastName: "Lee",
      email: "ann@example.com",
    });

    const updated = await service.updateEmployee("t1", employee.id, {
      bankDetails: { accountNumber: "5551234567" },
    });

    expect(JSON.stringify(updated.bankDetails)).not.toContain("5551234567");
    const decrypted: any = await service.getEmployeeBankDetails("t1", employee.id);
    expect(decrypted.accountNumber).toBe("5551234567");
  });
});
