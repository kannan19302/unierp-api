/**
 * M41 (catalogue half): "Every platform event is documented, emitted
 * through the outbox and replayable."
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

let entries: any[];
let seq = 0n;

vi.mock("@kannan19302/database", () => ({
  prisma: {
    platformEventOutboxEntry: {
      create: vi.fn(({ data }: any) => {
        seq += 1n;
        const row = { id: `evt-${seq}`, sequence: seq, occurredAt: new Date(), ...data };
        entries.push(row);
        return row;
      }),
      findMany: vi.fn(({ where }: any) => {
        return entries.filter((e) => e.sequence > where.sequence.gt).sort((a, b) => (a.sequence < b.sequence ? -1 : 1));
      }),
    },
  },
}));

import { PlatformEventBusService, PLATFORM_EVENT_CATALOG } from "./platform-event-bus.service";

describe("M41 · platform event catalogue and outbox", () => {
  let bus: PlatformEventBusService;

  beforeEach(() => {
    vi.clearAllMocks();
    entries = [];
    seq = 0n;
    bus = new PlatformEventBusService();
  });

  it("refuses to emit an event not in PLATFORM_EVENT_CATALOG — documented is enforced, not aspirational", async () => {
    await expect(bus.emit("not.a.real.event", {})).rejects.toThrow(/not a documented platform event/);
    expect(entries).toHaveLength(0);
  });

  it("every catalogue entry can actually be emitted and written to the outbox", async () => {
    for (const def of PLATFORM_EVENT_CATALOG) {
      await bus.emit(def.eventType, { probe: def.eventType });
    }
    expect(entries).toHaveLength(PLATFORM_EVENT_CATALOG.length);
  });

  it("REPLAYABLE — events since a sequence come back in strict order, unmutated by the read", async () => {
    await bus.emit("resource.drift-detected", { a: 1 });
    await bus.emit("plan.executed", { b: 2 });
    await bus.emit("incident.opened", { c: 3 });

    const fromStart = await bus.replay(0n);
    expect(fromStart.map((e: any) => e.eventType)).toEqual(["resource.drift-detected", "plan.executed", "incident.opened"]);

    const fromMiddle = await bus.replay(fromStart[0].sequence);
    expect(fromMiddle.map((e: any) => e.eventType)).toEqual(["plan.executed", "incident.opened"]);

    // replaying again must return the SAME thing — a read, not a consume
    const fromMiddleAgain = await bus.replay(fromStart[0].sequence);
    expect(fromMiddleAgain).toEqual(fromMiddle);
  });
});
