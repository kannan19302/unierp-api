/**
 * E07 exit criterion: "A 10,000-row bulk edit reports per-row outcomes,
 * does not time out, and does not lock the table for other tenants."
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

let records: Record<string, any>;
let transactionCalls: number;
let concurrentWriteCalls: number;
let maxConcurrentWrites: number;

vi.mock("@kannan19302/database", () => ({
  prisma: {
    $transaction: vi.fn(async () => {
      transactionCalls++;
    }),
    customer: {
      create: vi.fn(),
      findUnique: vi.fn(async ({ where }: any) => records[where.id] ?? null),
      update: vi.fn(async ({ where, data }: any) => {
        // Simulate a real Postgres transaction-abort: if this write were
        // sharing a transaction with a prior failed write, it would throw
        // here too. Independent (non-shared-transaction) writes must NOT
        // be affected by another row's failure.
        concurrentWriteCalls++;
        maxConcurrentWrites = Math.max(maxConcurrentWrites, concurrentWriteCalls);
        if (where.id === "poison-row") {
          concurrentWriteCalls--;
          throw new Error("unique constraint violation");
        }
        await new Promise((r) => setTimeout(r, 0)); // yield, so concurrent calls actually overlap
        Object.assign(records[where.id], data);
        concurrentWriteCalls--;
        return records[where.id];
      }),
    },
  },
}));

import { BulkOperationsService } from "../bulk-operations.service";

describe("E07 · bulk operations must not wrap the whole batch in one long transaction", () => {
  let service: BulkOperationsService;

  beforeEach(() => {
    vi.clearAllMocks();
    transactionCalls = 0;
    concurrentWriteCalls = 0;
    maxConcurrentWrites = 0;
    records = {};
    for (let i = 0; i < 50; i++) records[`row-${i}`] = { id: `row-${i}`, tenantId: "t1", name: "old" };
    records["poison-row"] = { id: "poison-row", tenantId: "t1", name: "old" };
    service = new BulkOperationsService();
  });

  it("one failing row does NOT poison every row after it in the batch — each row's outcome is independently reported", async () => {
    const ids = ["row-0", "poison-row", "row-1", "row-2"]; // poison in the middle
    const result = await service.bulkUpdate("t1", "customer", ids, { name: "new" });

    // row-0 (before the poison) and rows AFTER it must both succeed —
    // a single shared transaction would fail every row after "poison-row"
    // too, because Postgres aborts the whole transaction on the first error.
    expect(result.succeeded).toBe(3);
    expect(result.failed).toBe(1);
    expect(records["row-1"].name).toBe("new");
    expect(records["row-2"].name).toBe("new");
  });

  it("a 10,000-row bulk edit never wraps the whole batch in one shared transaction, and bounds concurrency", async () => {
    const ids = Array.from({ length: 10000 }, (_, i) => `row-${i % 50}`);
    await service.bulkUpdate("t1", "customer", ids, { name: "bulk" });

    // No row's write shares a transaction with any other row's write — a
    // single $transaction spanning all 10,000 rows is exactly the shape
    // that times out and holds locks for the whole operation.
    expect(transactionCalls).toBe(0);
    // Concurrency is bounded (not literally 10,000 simultaneous writes,
    // which would exhaust the connection pool) but still parallel, not
    // one-at-a-time serial inside a single lock-holding transaction.
    expect(maxConcurrentWrites).toBeGreaterThan(1);
    expect(maxConcurrentWrites).toBeLessThan(1000);
  });
});
