/**
 * E10 exit criterion: "...allocation, part-payment... every posting
 * traceable to a source document."
 *
 * FinanceService.createPayment() converts Decimal(19,4) invoice fields
 * (paidAmount, totalAmount) to plain JS `Number` and does the
 * fully-paid-vs-partially-paid decision with FLOAT arithmetic and a
 * strict `===` equality check:
 *
 *   const newPaidAmount = currentPaid + dto.amount;
 *   const nextStatus = newPaidAmount === totalAmount ? "PAID" : "PARTIALLY_PAID";
 *
 * IEEE 754 float addition is not exact. A sequence of legitimate partial
 * payments that mathematically sum to exactly the invoice total can land
 * on a float value that is NOT === totalAmount (e.g. 0.2 + 0.1 =
 * 0.30000000000000004, not 0.3). The invoice then never transitions to
 * PAID even though it has been paid in full — the same float-vs-Decimal
 * class of bug already fixed in gl-accounting.service.ts (D084), on a
 * different code path.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@prisma/client", () => {
  return {
    Prisma: {
      Decimal: class Decimal {
        value: number;
        constructor(value: unknown) {
          this.value = value instanceof Decimal ? value.value : Number(value);
        }
        plus(other: any) {
          // Real Prisma.Decimal does exact arbitrary-precision decimal
          // arithmetic (no IEEE 754 drift). Rounding to the column's
          // declared scale (4 dp, matching Decimal(19,4)) after each op
          // reproduces that exactness for test purposes without pulling
          // in a full decimal library.
          return new Decimal(
            (this.value + Number(other.value ?? other)).toFixed(4),
          );
        }
        greaterThan(other: any) {
          return this.value > Number(other.value ?? other);
        }
        equals(other: any) {
          return this.value === Number(other.value ?? other);
        }
        toString() {
          return String(this.value);
        }
        valueOf() {
          return this.value;
        }
      },
    },
  };
});

let invoiceRow: any;
let updatedInvoice: any;

vi.mock("@kannan19302/database", () => ({
  prisma: {
    invoice: {
      findFirst: vi.fn(() => invoiceRow),
      update: vi.fn(({ data }: any) => {
        updatedInvoice = { ...invoiceRow, ...data };
        return updatedInvoice;
      }),
    },
    $transaction: vi.fn(async (cb: any) =>
      cb({
        payment: {
          create: vi.fn(({ data }: any) => ({ id: "pay-1", ...data })),
        },
        invoice: {
          update: vi.fn(({ data }: any) => {
            updatedInvoice = { ...invoiceRow, ...data };
            return updatedInvoice;
          }),
        },
      }),
    ),
  },
}));

import { FinanceService } from "../finance.service";

describe("E10 · FinanceService.createPayment() paid-in-full detection is exact, not float-tolerant", () => {
  let service: FinanceService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new FinanceService();
    updatedInvoice = undefined;
  });

  it("marks an invoice PAID when a final partial payment mathematically completes it, even under float drift", async () => {
    // Invoice already has 0.2 paid (e.g. two prior 0.1 payments), total is 0.3.
    // A final 0.1 payment mathematically completes it exactly.
    // In raw JS floats: 0.2 + 0.1 = 0.30000000000000004 !== 0.3.
    invoiceRow = {
      id: "inv-1",
      tenantId: "t1",
      status: "PARTIALLY_PAID",
      paidAmount: 0.2,
      totalAmount: 0.3,
    };

    const result = await service.createPayment(
      "t1",
      { invoiceId: "inv-1", amount: 0.1, method: "CASH" } as any,
      "user-1",
    );

    expect(result).toBeTruthy();
    expect(updatedInvoice.status).toBe("PAID");
  });
});
