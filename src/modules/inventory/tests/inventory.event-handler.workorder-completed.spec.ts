/**
 * E18 exit criterion: "...WIP valuation... scrap and yield..."
 *
 * InventoryEventHandler.handleWorkOrderCompleted() consumes raw
 * materials (decrement) and produces finished goods (increment) as two
 * separate, unwrapped upserts. If the finished-goods upsert failed after
 * some raw-material decrements had already committed, the warehouse was
 * left with materials silently vanished and no finished goods produced —
 * a permanent, silent WIP integrity gap, with the failure only logged,
 * never rolled back.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@prisma/client", () => ({
  Prisma: {
    Decimal: class Decimal {
      value: number;
      constructor(v: unknown) {
        this.value = Number(v);
      }
      valueOf() {
        return this.value;
      }
    },
  },
}));

const decrementCalls: any[] = [];
const incrementCalls: any[] = [];

vi.mock("@kannan19302/database", () => ({
  prisma: {
    inventoryItem: {
      upsert: vi.fn(),
      findFirst: vi.fn(),
    },
    purchaseOrder: {
      findFirst: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

import { InventoryEventHandler } from "../inventory.event-handler";
import { prisma } from "@kannan19302/database";
import { EventEmitter2 } from "@nestjs/event-emitter";

describe("E18 · InventoryEventHandler.handleWorkOrderCompleted() atomicity", () => {
  let handler: InventoryEventHandler;

  beforeEach(() => {
    vi.clearAllMocks();
    decrementCalls.length = 0;
    incrementCalls.length = 0;
    handler = new InventoryEventHandler(new EventEmitter2());
  });

  const event = {
    tenantId: "t1",
    workOrderId: "wo-1",
    productId: "finished-1",
    quantity: 10,
    warehouseId: "wh-1",
    items: [{ productId: "raw-1", quantity: 5 }],
  };

  it("never commits a raw-material decrement if the finished-goods production step fails — atomic via $transaction", async () => {
    // Simulate the real prisma.$transaction behavior: it invokes the
    // callback with a tx client; if any operation inside throws, NOTHING
    // committed by earlier operations in that callback should be
    // observable afterward (that's what a transaction guarantees). We
    // simulate the tx client's upsert failing on the SECOND call
    // (the finished-goods increment) and assert that a real transaction
    // implementation would have been used — i.e. the handler wraps both
    // steps in a single prisma.$transaction call, not two independent
    // top-level prisma calls.
    let callCount = 0;
    vi.mocked(prisma.$transaction).mockImplementation(async (cb: any) => {
      const tx = {
        inventoryItem: {
          upsert: vi.fn(async (args: any) => {
            callCount++;
            if (callCount === 1) {
              decrementCalls.push(args);
              return {};
            }
            // Finished-goods increment fails
            throw new Error("DB write failed for finished-goods increment");
          }),
        },
      };
      return cb(tx);
    });

    await handler.handleWorkOrderCompleted(event as any);

    // The whole operation went through prisma.$transaction exactly once —
    // proving atomicity is delegated to a real transaction, not two
    // independent top-level calls that could partially commit.
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(decrementCalls).toHaveLength(1);
  });

  it("performs raw-material consumption and finished-goods production inside the same prisma.$transaction call", async () => {
    const txUpsertCalls: any[] = [];
    vi.mocked(prisma.$transaction).mockImplementation(async (cb: any) => {
      const tx = {
        inventoryItem: {
          upsert: vi.fn(async (args: any) => {
            txUpsertCalls.push(args);
            return {};
          }),
        },
      };
      return cb(tx);
    });
    vi.mocked(prisma.inventoryItem.findFirst).mockResolvedValue(null);

    await handler.handleWorkOrderCompleted(event as any);

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    // Both the raw-material decrement and finished-goods increment ran
    // through the SAME tx client passed into the single $transaction call.
    expect(txUpsertCalls).toHaveLength(2);
  });
});
