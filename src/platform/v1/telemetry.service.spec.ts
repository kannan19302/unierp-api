/**
 * M26 exit criterion: "Utilisation for any resource is available within
 * its stated freshness bound, and the bound is asserted by test rather
 * than documented. Gaps are reported as gaps, never interpolated to
 * zero."
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

let samples: any[];
let seq = 0;
const nextId = (p: string) => `${p}-${++seq}`;

vi.mock("@kannan19302/database", () => ({
  prisma: {
    telemetrySample: {
      create: vi.fn(({ data }: any) => {
        const row = { id: nextId("sample"), ...data };
        samples.push(row);
        return row;
      }),
      findFirst: vi.fn(({ where }: any) => {
        const rows = samples
          .filter((s) => s.resourceId === where.resourceId && s.metric === where.metric)
          .sort((a, b) => new Date(b.observedAt).getTime() - new Date(a.observedAt).getTime());
        return rows[0] ?? null;
      }),
      findMany: vi.fn(({ where }: any) =>
        samples.filter(
          (s) =>
            s.resourceId === where.resourceId &&
            s.metric === where.metric &&
            new Date(s.observedAt) >= where.observedAt.gte &&
            new Date(s.observedAt) < where.observedAt.lt,
        ),
      ),
    },
  },
}));

import { TelemetryService, DEFAULT_FRESHNESS_BOUND_MS } from "./telemetry.service";

describe("M26 · real-time usage and consumption telemetry", () => {
  let telemetry: TelemetryService;

  beforeEach(() => {
    vi.clearAllMocks();
    samples = [];
    telemetry = new TelemetryService();
  });

  it("utilisation for a resource is FRESH within its stated freshness bound — asserted by test, not documented", async () => {
    const t0 = new Date("2026-08-11T12:00:00Z");
    await telemetry.recordSample("res-1", "cpu", 42, t0);

    // Read at exactly the bound minus 1ms: still fresh.
    const justInside = new Date(t0.getTime() + DEFAULT_FRESHNESS_BOUND_MS - 1);
    const reading = await telemetry.getUtilization("res-1", "cpu", justInside);

    expect(reading.status).toBe("FRESH");
    expect(reading.value).toBe(42);
  });

  it("utilisation goes STALE the instant it crosses the freshness bound — the bound is a real, testable line, not a suggestion", async () => {
    const t0 = new Date("2026-08-11T12:00:00Z");
    await telemetry.recordSample("res-1", "cpu", 42, t0);

    const justOutside = new Date(t0.getTime() + DEFAULT_FRESHNESS_BOUND_MS + 1);
    const reading = await telemetry.getUtilization("res-1", "cpu", justOutside);

    expect(reading.status).toBe("STALE");
    // The core of this exit criterion: a gap is never reported as a
    // usable number, let alone zero.
    expect(reading.value).toBeNull();
  });

  it("a resource with no samples at all is NO_DATA, not zero", async () => {
    const reading = await telemetry.getUtilization("never-reported", "cpu", new Date());
    expect(reading.status).toBe("NO_DATA");
    expect(reading.value).toBeNull();
  });

  it("a custom freshness bound is honoured exactly, not just the default", async () => {
    const t0 = new Date("2026-08-11T12:00:00Z");
    await telemetry.recordSample("res-2", "memory", 70, t0);

    const oneMinuteBoundMs = 60_000;
    const at90Seconds = new Date(t0.getTime() + 90_000);
    const reading = await telemetry.getUtilization("res-2", "memory", at90Seconds, oneMinuteBoundMs);

    expect(reading.status).toBe("STALE");
  });

  it("gaps in a bucketed series are reported as gaps (null), never interpolated to zero", async () => {
    const from = new Date("2026-08-11T00:00:00Z");
    const to = new Date("2026-08-11T00:20:00Z");
    const intervalMs = 5 * 60 * 1000; // 5-minute buckets, 4 buckets total

    // Samples only in buckets 0 and 2 — bucket 1 and 3 have NOTHING, not
    // even a zero-valued reading.
    await telemetry.recordSample("res-3", "requests_per_sec", 100, new Date("2026-08-11T00:02:00Z"));
    await telemetry.recordSample("res-3", "requests_per_sec", 0, new Date("2026-08-11T00:12:00Z")); // a REAL zero reading

    const series = await telemetry.getUtilizationSeries("res-3", "requests_per_sec", from, to, intervalMs);

    expect(series).toHaveLength(4);
    expect(series[0]!.value).toBe(100);
    expect(series[1]!.value).toBeNull(); // genuine gap
    expect(series[2]!.value).toBe(0); // a REAL zero, distinguishable from the gap
    expect(series[3]!.value).toBeNull(); // genuine gap
  });
});
