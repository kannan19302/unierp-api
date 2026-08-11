/**
 * D08 exit criterion: "An import with 200 bad rows out of 10,000
 * reports every one actionably, imports nothing, and is re-runnable
 * after correction."
 *
 * ImportExportService.executeImport() previously committed row-by-row
 * with a try/catch PER ROW — a batch with any bad rows still imported
 * every GOOD row, violating "imports nothing." This spec proves that
 * gap directly (scaled down to 10 rows / 2 bad, the same shape), then
 * proves the fix: all-or-nothing, actionable per-row errors, and a
 * clean re-run after correction.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

let customers: any[];
let seq = 0;

vi.mock("@kannan19302/database", () => ({
  prisma: {
    customer: {
      create: vi.fn(({ data }: any) => {
        if (customers.some((c) => c.email === data.email)) {
          throw new Error(`Unique constraint failed on the fields: (\`email\`)`);
        }
        const row = { id: `cust-${++seq}`, ...data };
        customers.push(row);
        return row;
      }),
    },
    auditLog: { findMany: vi.fn(() => []) },
    $transaction: vi.fn(async (cb: any) => {
      // A real Prisma interactive transaction: any thrown error inside
      // cb() must leave the store exactly as it was before the call —
      // simulated here by snapshotting and restoring on throw.
      const snapshot = [...customers];
      try {
        return await cb({
          customer: {
            create: vi.fn(({ data }: any) => {
              if (customers.some((c) => c.email === data.email)) {
                throw new Error(`Unique constraint failed on the fields: (\`email\`)`);
              }
              const row = { id: `cust-${++seq}`, ...data };
              customers.push(row);
              return row;
            }),
          },
        });
      } catch (err) {
        customers.length = 0;
        customers.push(...snapshot);
        throw err;
      }
    }),
  },
}));

import { ImportExportService } from "../import-export.service";

describe("D08 · import framework — all-or-nothing, actionable errors, re-runnable", () => {
  let importSvc: ImportExportService;

  beforeEach(() => {
    vi.clearAllMocks();
    customers = [];
    seq = 0;
    importSvc = new ImportExportService();
  });

  function rows(n: number, badIndexes: number[]) {
    return Array.from({ length: n }, (_, i) => {
      if (badIndexes.includes(i)) return { email: `dup@example.com` }; // missing required `name`, AND a duplicate email
      return { name: `Customer ${i}`, email: `c${i}@example.com` };
    });
  }

  it("SCHEMA-INVALID rows: every bad row is reported ACTIONABLY (row + field + message), and NOTHING is imported", async () => {
    const batch = rows(10, [3, 7]); // rows at index 3 and 7 are missing `name`

    const result = await importSvc.executeImport("t1", "org1", "Customer", batch);

    expect(result.created).toBe(0); // imports nothing — not even the 8 good rows
    expect(customers).toHaveLength(0);
    expect(result.errors).toHaveLength(2);
    expect(result.errors.map((e: any) => e.row).sort()).toEqual([4, 8]); // 1-indexed
    expect(result.errors.every((e: any) => e.field && e.message)).toBe(true); // actionable, not just a row number
  });

  it("ALL-OR-NOTHING at the database level too: a duplicate-constraint failure on ONE row rolls back every already-inserted row in the same batch", async () => {
    // Two rows share the same email — the second one fails uniqueness at
    // the database layer, not schema validation, so this must be caught
    // by transactional atomicity, not the upfront field check.
    const batch = [
      { name: "Alice", email: "same@example.com" },
      { name: "Bob", email: "same@example.com" },
      { name: "Carol", email: "carol@example.com" },
    ];

    const result = await importSvc.executeImport("t1", "org1", "Customer", batch);

    expect(result.created).toBe(0);
    expect(customers).toHaveLength(0); // Alice was NOT left behind despite succeeding first
  });

  it("a CLEAN batch imports every row", async () => {
    const batch = rows(10, []);
    const result = await importSvc.executeImport("t1", "org1", "Customer", batch);
    expect(result.created).toBe(10);
    expect(customers).toHaveLength(10);
  });

  it("RE-RUNNABLE: correcting the bad rows and re-submitting succeeds cleanly, with no residue from the failed attempt", async () => {
    const badBatch = rows(5, [2]);
    const failed = await importSvc.executeImport("t1", "org1", "Customer", badBatch);
    expect(failed.created).toBe(0);
    expect(customers).toHaveLength(0);

    const correctedBatch = badBatch.map((r, i) => (i === 2 ? { name: "Fixed Row", email: "fixed@example.com" } : r));
    const succeeded = await importSvc.executeImport("t1", "org1", "Customer", correctedBatch);

    expect(succeeded.created).toBe(5);
    expect(succeeded.errors).toHaveLength(0);
    expect(customers).toHaveLength(5); // exactly the corrected batch, no duplicate from the failed attempt
  });
});
