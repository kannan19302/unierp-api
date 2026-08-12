/**
 * E21 exit criterion: "Statutory-correct payroll per jurisdiction...".
 *
 * AdvancedHrService.runPayroll() had no check for whether a payroll run
 * had already been PAID for the exact same period. Calling it twice for
 * the same period silently created a second, independent PayrollRun
 * with its own PayrollSlips — double-paying every employee, with
 * nothing to catch or prevent it.
 *
 * The money-arithmetic in this function was also converted from plain
 * `number` to `Prisma.Decimal` in this same pass, matching
 * CODE_STANDARDS' "money is never converted to number for arithmetic"
 * rule already enforced elsewhere (D084/D085/D086) — a defensive fix
 * without a demonstrable business-impact reconciliation failure at
 * realistic payroll sizes (verified: accumulation drift stays below
 * 1e-10 for this function's specific multiply/subtract/sum pattern,
 * unlike the equality/threshold-check bugs in D084/D085/D086).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@prisma/client", () => ({
  Prisma: {
    Decimal: class Decimal {
      value: number;
      constructor(v: unknown) {
        this.value = v instanceof Decimal ? v.value : Number(v);
      }
      private round(n: number) {
        return Number(n.toFixed(4));
      }
      plus(other: any) {
        return new Decimal(
          this.round(this.value + Number(other?.value ?? other)),
        );
      }
      sub(other: any) {
        return new Decimal(
          this.round(this.value - Number(other?.value ?? other)),
        );
      }
      mul(other: any) {
        return new Decimal(
          this.round(this.value * Number(other?.value ?? other)),
        );
      }
      div(other: any) {
        return new Decimal(
          this.round(this.value / Number(other?.value ?? other)),
        );
      }
      toString() {
        return String(this.value);
      }
      valueOf() {
        return this.value;
      }
    },
  },
}));

let structures: any[];
let existingPaidRuns: any[];
let createdRuns: any[];

vi.mock("@kannan19302/database", () => ({
  prisma: {
    salaryStructure: {
      findMany: vi.fn(() => structures),
    },
    employee: {
      findUnique: vi.fn(() => ({ id: "emp", address: { country: "US" } })),
    },
    taxTable: {
      findMany: vi.fn(() => []),
    },
    payrollRun: {
      findFirst: vi.fn(
        ({ where }: any) =>
          existingPaidRuns.find(
            (r) =>
              r.tenantId === where.tenantId &&
              r.periodStart.getTime() === where.periodStart.getTime() &&
              r.periodEnd.getTime() === where.periodEnd.getTime() &&
              r.status === where.status,
          ) ?? null,
      ),
      create: vi.fn(({ data }: any) => {
        const run = { id: `run-${createdRuns.length + 1}`, ...data };
        createdRuns.push(run);
        return run;
      }),
      update: vi.fn(({ data }: any) => ({ id: "run-x", ...data, slips: [] })),
    },
    payrollSlip: {
      create: vi.fn((args: any) => args.data),
    },
    $transaction: vi.fn(async (cb: any) =>
      cb({
        payrollRun: {
          create: vi.fn(({ data }: any) => {
            const run = { id: `run-${createdRuns.length + 1}`, ...data };
            createdRuns.push(run);
            return run;
          }),
          update: vi.fn(({ data }: any) => ({
            id: "run-x",
            ...data,
            slips: [],
          })),
        },
        payrollSlip: {
          create: vi.fn((args: any) => args.data),
        },
        employee: {
          findUnique: vi.fn(() => ({ id: "emp", address: { country: "US" } })),
        },
        taxTable: {
          findMany: vi.fn(() => []),
        },
      }),
    ),
  },
}));

import { AdvancedHrService } from "../advanced-hr.service";

describe("E21 · AdvancedHrService.runPayroll() refuses to double-pay a period already paid", () => {
  let service: AdvancedHrService;

  beforeEach(() => {
    vi.clearAllMocks();
    createdRuns = [];
    structures = [{ employeeId: "emp-1", baseSalary: 1000 }];
    service = new AdvancedHrService();
  });

  it("REFUSES to run payroll again for a period that has already been PAID", async () => {
    existingPaidRuns = [
      {
        tenantId: "t1",
        periodStart: new Date("2026-01-01"),
        periodEnd: new Date("2026-01-31"),
        status: "PAID",
      },
    ];

    await expect(
      service.runPayroll("t1", {
        periodStart: "2026-01-01",
        periodEnd: "2026-01-31",
      }),
    ).rejects.toThrow(/already been run and paid/i);

    expect(createdRuns).toHaveLength(0);
  });

  it("allows running payroll for a period with no prior PAID run", async () => {
    existingPaidRuns = [];

    const result = await service.runPayroll("t1", {
      periodStart: "2026-02-01",
      periodEnd: "2026-02-28",
    });

    expect(result).toBeDefined();
    expect(createdRuns).toHaveLength(1);
  });
});
