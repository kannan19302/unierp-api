/**
 * M26 — real-time usage and consumption telemetry. Two invariants the
 * exit criterion names explicitly, both enforced here rather than left
 * to convention:
 *
 *   1. A stated freshness bound: `getUtilization()` compares the most
 *      recent sample's age against `freshnessBoundMs` at READ time (the
 *      caller's clock, injectable for the test), not something baked
 *      into the sample when it was written.
 *   2. Gaps are gaps: a resource/metric with no sample recent enough to
 *      be fresh returns `{ status: "STALE" | "NO_DATA", value: null }` —
 *      never `{ value: 0 }`. Zero is a real, distinct reading; "we don't
 *      know" must never look identical to it.
 */
import { Injectable } from "@nestjs/common";
import { prisma } from "@kannan19302/database";

export const DEFAULT_FRESHNESS_BOUND_MS = 5 * 60 * 1000; // 5 minutes

export type UtilizationStatus = "FRESH" | "STALE" | "NO_DATA";

export interface UtilizationReading {
  status: UtilizationStatus;
  /** null whenever status is not FRESH — a gap is never reported as 0. */
  value: number | null;
  observedAt: Date | null;
  ageMs: number | null;
}

export interface UtilizationBucket {
  bucketStart: Date;
  /** null = a genuine gap: no sample fell in this bucket. Never 0. */
  value: number | null;
}

@Injectable()
export class TelemetryService {
  async recordSample(resourceId: string, metric: string, value: number, observedAt: Date = new Date()) {
    return (prisma as any).telemetrySample.create({ data: { resourceId, metric, value, observedAt } });
  }

  /**
   * `now` is a parameter, not `Date.now()` called internally, precisely
   * so the exit criterion's "asserted by test" can drive the clock past
   * the freshness bound deterministically rather than relying on a real
   * sleep.
   */
  async getUtilization(
    resourceId: string,
    metric: string,
    now: Date = new Date(),
    freshnessBoundMs: number = DEFAULT_FRESHNESS_BOUND_MS,
  ): Promise<UtilizationReading> {
    const latest = await (prisma as any).telemetrySample.findFirst({
      where: { resourceId, metric },
      orderBy: { observedAt: "desc" },
    });
    if (!latest) {
      return { status: "NO_DATA", value: null, observedAt: null, ageMs: null };
    }
    const ageMs = now.getTime() - new Date(latest.observedAt).getTime();
    if (ageMs > freshnessBoundMs) {
      return { status: "STALE", value: null, observedAt: latest.observedAt, ageMs };
    }
    return { status: "FRESH", value: latest.value, observedAt: latest.observedAt, ageMs };
  }

  /**
   * A bucketed series over [from, to) — every bucket that has no sample
   * is reported with `value: null`, a genuine gap, never interpolated or
   * defaulted to 0. A resource that was simply idle (a real 0 reading)
   * is indistinguishable from nothing at all unless gaps stay null.
   */
  async getUtilizationSeries(
    resourceId: string,
    metric: string,
    from: Date,
    to: Date,
    intervalMs: number,
  ): Promise<UtilizationBucket[]> {
    const samples = await (prisma as any).telemetrySample.findMany({
      where: { resourceId, metric, observedAt: { gte: from, lt: to } },
      orderBy: { observedAt: "asc" },
    });

    const buckets: UtilizationBucket[] = [];
    for (let t = from.getTime(); t < to.getTime(); t += intervalMs) {
      const bucketStart = new Date(t);
      const bucketEnd = new Date(t + intervalMs);
      const inBucket = samples.filter(
        (s: any) => new Date(s.observedAt).getTime() >= bucketStart.getTime() && new Date(s.observedAt).getTime() < bucketEnd.getTime(),
      );
      buckets.push({
        bucketStart,
        value: inBucket.length === 0 ? null : inBucket[inBucket.length - 1].value,
      });
    }
    return buckets;
  }
}
