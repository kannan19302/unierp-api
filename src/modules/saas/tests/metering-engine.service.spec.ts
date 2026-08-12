/**
 * K05 exit criterion: "Metering is idempotent under replay: the same
 * event delivered twice is counted once, proven by test."
 *
 * processUsageBatch() previously called prisma.saasUsageEventBatch.create()
 * unconditionally. batchRef is @unique in the schema, so a genuine replay
 * (the same batchRef delivered twice) threw an unhandled Prisma P2002
 * unique-constraint error instead of being recognized as a no-op replay —
 * and a caller that regenerated batchRef on retry could double-count the
 * same usage events toward billing.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

let batches: any[];

vi.mock("@kannan19302/database", () => ({
  prisma: {
    saasUsageEventBatch: {
      findFirst: vi.fn(({ where }: any) =>
        batches.find(
          (b) => b.tenantId === where.tenantId && b.batchRef === where.batchRef,
        ) ?? null,
      ),
      create: vi.fn(({ data }: any) => {
        const row = { id: `b-${batches.length + 1}`, ...data };
        batches.push(row);
        return row;
      }),
    },
  },
}));

import { SaasMeteringEngineDeepService } from "../metering-engine.service";

describe("SaasMeteringEngineDeepService.processUsageBatch", () => {
  let service: SaasMeteringEngineDeepService;

  beforeEach(() => {
    batches = [];
    service = new SaasMeteringEngineDeepService();
  });

  it("processes a new batch once", async () => {
    const result = await service.processUsageBatch("t1", {
      batchRef: "batch-abc",
      events: [{ metric: "api_call" }, { metric: "api_call" }],
    });
    expect(result.eventCount).toBe(2);
    expect(batches).toHaveLength(1);
  });

  it("K05: the same batchRef delivered twice is counted once, not reprocessed or errored", async () => {
    const first = await service.processUsageBatch("t1", {
      batchRef: "batch-replay",
      events: [{ metric: "api_call" }, { metric: "api_call" }],
    });
    const second = await service.processUsageBatch("t1", {
      batchRef: "batch-replay",
      events: [{ metric: "api_call" }, { metric: "api_call" }],
    });

    expect(second.id).toBe(first.id);
    expect(batches).toHaveLength(1);
  });

  it("K05: the same batchRef under a different tenant is treated as a distinct batch", async () => {
    await service.processUsageBatch("t1", {
      batchRef: "batch-shared",
      events: [{ metric: "api_call" }],
    });
    await service.processUsageBatch("t2", {
      batchRef: "batch-shared",
      events: [{ metric: "api_call" }],
    });
    expect(batches).toHaveLength(2);
  });

  it("rejects a batch with no batchRef instead of silently generating a fresh one", async () => {
    await expect(
      service.processUsageBatch("t1", {
        batchRef: "" as any,
        events: [{ metric: "api_call" }],
      }),
    ).rejects.toThrow(/batchRef is required/);
  });
});
