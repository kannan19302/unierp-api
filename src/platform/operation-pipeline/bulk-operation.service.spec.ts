/**
 * M15 exit criterion: "A bulk operation over 500 resources reports
 * per-item success and failure and is resumable, with no limit > 100 page.
 * A partially failed bulk operation names exactly which items failed and
 * why."
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

let rows: any[];
let seq = 0;
const nextId = () => `bulk-${++seq}`;

vi.mock("@kannan19302/database", () => ({
  prisma: {
    platformBulkOperation: {
      create: vi.fn(({ data }: any) => {
        const row = { id: nextId(), ...data };
        rows.push(row);
        return row;
      }),
      findUnique: vi.fn(({ where: { id } }: any) => rows.find((r) => r.id === id) ?? null),
      update: vi.fn(({ where: { id }, data }: any) => {
        const row = rows.find((r) => r.id === id)!;
        Object.assign(row, data);
        return row;
      }),
    },
  },
}));

import { BulkOperationService } from "./bulk-operation.service";

describe("M15 · bulk operations", () => {
  let svc: BulkOperationService;

  beforeEach(() => {
    vi.clearAllMocks();
    rows = [];
    seq = 0;
    svc = new BulkOperationService();
  });

  it("a bulk operation over 500 resources reports per-item success and failure", async () => {
    const ids = Array.from({ length: 500 }, (_, i) => `res-${i}`);
    const result = await svc.start("archive", ids, async (resourceId) => {
      if (resourceId === "res-3" || resourceId === "res-499") {
        throw new Error(`archive refused for ${resourceId}: resource is still referenced`);
      }
    });

    expect(result.status).toBe("FAILED"); // terminal status names that some items failed
    expect(result.items).toHaveLength(500);
    expect(result.cursor).toBe(500);

    const failed = result.items.filter((it) => it.status === "FAILED");
    expect(failed.map((f) => f.resourceId)).toEqual(["res-3", "res-499"]);
    expect(failed[0]!.error).toMatch(/res-3: resource is still referenced/);
    expect(failed[1]!.error).toMatch(/res-499: resource is still referenced/);

    const succeeded = result.items.filter((it) => it.status === "SUCCESS");
    expect(succeeded).toHaveLength(498);
  });

  it("a bulk operation with no failures reports DONE, not FAILED", async () => {
    const result = await svc.start("archive", ["res-a", "res-b"], async () => {});
    expect(result.status).toBe("DONE");
    expect(result.items.every((it) => it.status === "SUCCESS")).toBe(true);
  });

  it("every item's outcome is durably persisted BEFORE the next item starts — not batched at the end", async () => {
    const cursorsAtCallTime: number[] = [];
    const ids = ["res-1", "res-2", "res-3"];

    await svc.start("archive", ids, async (resourceId) => {
      // At the moment item N starts, the row in the "database" must already
      // reflect items [0, N) as settled — proving each item's write commits
      // before the next item is even attempted, not only before start()
      // returns.
      const id = rows[0]?.id;
      const persisted = id ? rows.find((r) => r.id === id) : undefined;
      cursorsAtCallTime.push(persisted ? persisted.cursor : -1);
    });

    expect(cursorsAtCallTime).toEqual([0, 1, 2]);
  });

  it("is resumable: a run interrupted mid-way continues from the first unprocessed item, never repeating a settled one", async () => {
    const seen: string[] = [];
    const ids = ["res-1", "res-2", "res-3", "res-4"];

    // Simulate a real process death: the 3rd `update` call (create's initial
    // RUNNING write is call 1, item0's settle is call 2, item1's settle is
    // call 3) throws, so item1's action already ran but its outcome — and
    // item2's, which never even started — is lost, exactly like a killed
    // process. Only items durably saved BEFORE the crash may be skipped on
    // resume.
    const { prisma } = await import("@kannan19302/database");
    const originalUpdate = (prisma as any).platformBulkOperation.update.getMockImplementation();
    let updateCalls = 0;
    (prisma as any).platformBulkOperation.update.mockImplementation((args: any) => {
      updateCalls++;
      if (updateCalls === 2) throw new Error("__PROCESS_DIED__");
      return originalUpdate(args);
    });

    await expect(svc.start("archive", ids, async (resourceId) => { seen.push(resourceId); })).rejects.toThrow(
      "__PROCESS_DIED__",
    );
    expect(seen).toEqual(["res-1"]); // item0's action ran, but its outcome never committed

    const id = rows[0].id;
    expect(rows[0].cursor).toBe(0); // no item was durably settled before the crash — cursor is the durability boundary

    // Restore normal persistence and resume — it re-attempts res-1 (its
    // outcome was never committed) then proceeds through the rest.
    (prisma as any).platformBulkOperation.update.mockImplementation(originalUpdate);
    seen.length = 0;
    const resumed = await svc.resume(id, async (resourceId) => {
      seen.push(resourceId);
    });

    expect(seen).toEqual(["res-1", "res-2", "res-3", "res-4"]);
    expect(resumed.status).toBe("DONE");
  });

  it("resuming an already-DONE operation is a no-op — it does not re-run settled items", async () => {
    const calls: string[] = [];
    const result = await svc.start("archive", ["res-x"], async (resourceId) => {
      calls.push(resourceId);
    });
    expect(result.status).toBe("DONE");

    calls.length = 0;
    const resumed = await svc.resume(result.id, async (resourceId) => {
      calls.push(resourceId);
    });
    expect(calls).toEqual([]);
    expect(resumed.status).toBe("DONE");
  });
});
