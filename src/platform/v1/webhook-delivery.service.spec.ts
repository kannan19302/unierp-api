/**
 * M41 (webhook half): "A webhook endpoint failing then recovering
 * receives its backlog in order, exactly once — asserted."
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

let endpoint: any;
let outboxEntries: any[];
let attempts: any[];

vi.mock("@kannan19302/database", () => ({
  prisma: {
    webhookEndpoint: {
      findUniqueOrThrow: vi.fn(() => ({ ...endpoint })),
      update: vi.fn(({ data }: any) => {
        endpoint = { ...endpoint, ...data };
        return { ...endpoint };
      }),
    },
    platformEventOutboxEntry: {
      findMany: vi.fn(({ where }: any) => {
        return outboxEntries
          .filter((e) => e.sequence > where.sequence.gt && where.eventType.in.includes(e.eventType))
          .sort((a, b) => (a.sequence < b.sequence ? -1 : 1));
      }),
    },
    webhookDeliveryAttempt: {
      create: vi.fn(({ data }: any) => {
        const row = { id: `att-${attempts.length + 1}`, ...data };
        attempts.push(row);
        return row;
      }),
    },
  },
}));

import { WebhookDeliveryService } from "./webhook-delivery.service";

describe("M41 · webhook delivery — backlog in order, exactly once, across a real failure and recovery", () => {
  let delivery: WebhookDeliveryService;

  beforeEach(() => {
    vi.clearAllMocks();
    attempts = [];
    endpoint = {
      id: "ep-1",
      url: "https://example.test/hook",
      secret: "s3cr3t",
      eventTypes: ["resource.drift-detected", "plan.executed", "incident.opened"],
      healthy: true,
      lastDeliveredSequence: 0n,
    };
    outboxEntries = [
      { sequence: 1n, eventType: "resource.drift-detected", payload: { a: 1 } },
      { sequence: 2n, eventType: "plan.executed", payload: { b: 2 } },
      { sequence: 3n, eventType: "incident.opened", payload: { c: 3 } },
    ];
    delivery = new WebhookDeliveryService();
  });

  it("signs each delivery with the endpoint's own secret", () => {
    const sig = delivery.sign("s3cr3t", "body");
    expect(sig).toHaveLength(64); // hex sha256
    expect(delivery.sign("different-secret", "body")).not.toBe(sig);
  });

  it("a failing endpoint stops mid-backlog, marked unhealthy, cursor NOT advanced past the failure", async () => {
    const transport = {
      send: vi.fn(async (_url: string, body: string) => {
        const parsed = JSON.parse(body);
        return { ok: parsed.eventType !== "plan.executed" }; // fails on event 2
      }),
    };

    const result = await delivery.deliverBacklog("ep-1", transport);

    expect(result.delivered).toBe(1); // only event 1 succeeded
    expect(result.healthy).toBe(false);
    expect(endpoint.healthy).toBe(false);
    expect(endpoint.lastDeliveredSequence).toBe(1n); // stopped BEFORE event 2
    expect(attempts.map((a) => [a.sequence, a.success])).toEqual([[1n, true], [2n, false]]);
  });

  it("RECOVERING receives exactly the remaining backlog, in order, exactly once — never re-delivers event 1", async () => {
    // First pass: fails on event 2, same as above.
    await delivery.deliverBacklog("ep-1", { send: vi.fn(async (_u, body) => ({ ok: JSON.parse(body).eventType !== "plan.executed" })) });
    expect(endpoint.lastDeliveredSequence).toBe(1n);
    attempts = []; // isolate the recovery pass's own delivery record

    // Recovery: transport now succeeds for everything.
    const recoveredTransport = { send: vi.fn(async () => ({ ok: true })) };
    const result = await delivery.deliverBacklog("ep-1", recoveredTransport);

    expect(result.delivered).toBe(2); // exactly events 2 and 3 — never event 1 again
    expect(result.healthy).toBe(true);
    expect(endpoint.lastDeliveredSequence).toBe(3n);
    expect(attempts.map((a) => a.sequence)).toEqual([2n, 3n]);
    expect(recoveredTransport.send).toHaveBeenCalledTimes(2);
  });

  it("delivery only ever includes an endpoint's own subscribed eventTypes", async () => {
    endpoint.eventTypes = ["incident.opened"];
    const transport = { send: vi.fn(async () => ({ ok: true })) };
    const result = await delivery.deliverBacklog("ep-1", transport);
    expect(result.delivered).toBe(1);
    expect(attempts.map((a) => a.eventType)).toEqual(["incident.opened"]);
  });
});
