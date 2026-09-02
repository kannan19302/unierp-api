/**
 * D12 exit criterion (legal-hold half): "Legal hold provably suspends
 * deletion."
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

let holds: any[];
let seq = 0;

vi.mock("@kannan19302/database", () => ({
  prisma: {
    recordLegalHold: {
      findFirst: vi.fn(({ where }: any) => {
        if (where.id) return holds.find((h) => h.id === where.id && h.tenantId === where.tenantId) ?? null;
        return holds.find((h) => h.tenantId === where.tenantId && h.entityType === where.entityType && h.entityId === where.entityId && h.releasedAt === null) ?? null;
      }),
      findMany: vi.fn(({ where }: any) =>
        holds.filter((h) => h.tenantId === where.tenantId && h.entityType === where.entityType && where.entityId.in.includes(h.entityId) && h.releasedAt === where.releasedAt),
      ),
      create: vi.fn(({ data }: any) => { const row = { id: `hold-${++seq}`, heldAt: new Date(), releasedAt: null, releasedBy: null, ...data }; holds.push(row); return row; }),
      update: vi.fn(({ where: { id }, data }: any) => { const row = holds.find((h) => h.id === id)!; Object.assign(row, data); return row; }),
    },
  },
}));

import { RecordLegalHoldService } from "../services/record-legal-hold.service";

describe("D12 · legal hold provably suspends deletion", () => {
  let legalHold: RecordLegalHoldService;

  beforeEach(() => {
    vi.clearAllMocks();
    holds = [];
    seq = 0;
    legalHold = new RecordLegalHoldService();
  });

  it("a record with NO hold is NOT on hold", async () => {
    expect(await legalHold.isOnHold("t1", "Invoice", "inv-1")).toBe(false);
  });

  it("PLACING a hold makes isOnHold() true — the check any deletion path must consult", async () => {
    await legalHold.placeHold("t1", "Invoice", "inv-1", "Litigation matter #4471", "user-a");
    expect(await legalHold.isOnHold("t1", "Invoice", "inv-1")).toBe(true);
  });

  it("REFUSES to place a second active hold on an already-held record", async () => {
    await legalHold.placeHold("t1", "Invoice", "inv-1", "reason A", "user-a");
    await expect(legalHold.placeHold("t1", "Invoice", "inv-1", "reason B", "user-b")).rejects.toThrow(/already/);
  });

  it("RELEASING a hold makes isOnHold() false again", async () => {
    const hold = await legalHold.placeHold("t1", "Invoice", "inv-1", "reason", "user-a");
    await legalHold.releaseHold("t1", hold.id, "user-b");
    expect(await legalHold.isOnHold("t1", "Invoice", "inv-1")).toBe(false);
  });

  it("EXCLUDES held records from a deletion candidate list — the exact filter a bulk retention/erasure run needs", async () => {
    await legalHold.placeHold("t1", "Invoice", "inv-2", "held", "user-a");

    const survivors = await legalHold.excludeHeld("t1", "Invoice", ["inv-1", "inv-2", "inv-3"]);

    expect(survivors).toEqual(["inv-1", "inv-3"]); // inv-2 is provably excluded — deletion suspended
  });

  it("a hold on entityType X never suspends deletion for the SAME entityId under a DIFFERENT entityType", async () => {
    await legalHold.placeHold("t1", "Invoice", "shared-id", "held", "user-a");
    expect(await legalHold.isOnHold("t1", "Contact", "shared-id")).toBe(false);
  });
});
