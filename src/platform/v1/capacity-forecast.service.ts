/**
 * M24 — capacity, scaling and performance. Extends C05's operations
 * dashboard rather than replacing it: this service is a new prediction
 * surface C05 can read from, not a rewrite of anything C05 already owns.
 *
 * The forecast is a plain linear trend fit over REAL recorded
 * observations (`CapacityObservation`) — never a synthetic single point.
 * "Checked against a real historical shortfall" means the test proving
 * this fits a genuine growth series and confirms the model would have
 * raised before the exact point that series actually crossed capacity.
 */
import { Injectable } from "@nestjs/common";
import { prisma } from "@kannan19302/database";
import { PlanningService, type Plan } from "../operation-pipeline/planning.service";
import { DurableExecutorService } from "../operation-pipeline/durable-executor.service";
import { ResourceModelService } from "../resource-model/resource-model.service";
import { ControlPlaneAuditService } from "./control-plane-audit.service";

export interface CapacityForecast {
  resourceId: string;
  metric: string;
  /** Units of the metric per day, fit from the recorded observations. */
  trendPerDay: number;
  latestValue: number;
  capacity: number;
  /** Days from the latest observation until the trend crosses capacity,
   *  or null if the trend is flat/decreasing and never will. */
  daysUntilShortfall: number | null;
  projectedShortfallAt: Date | null;
}

const DEFAULT_LOOKAHEAD_DAYS = 14;

@Injectable()
export class CapacityForecastService {
  constructor(
    private readonly resources: ResourceModelService,
    private readonly planning: PlanningService,
    private readonly executor: DurableExecutorService,
    private readonly audit: ControlPlaneAuditService,
  ) {}

  async recordObservation(resourceId: string, metric: string, value: number, capacity: number, observedAt: Date) {
    return (prisma as any).capacityObservation.create({
      data: { resourceId, metric, value, capacity, observedAt },
    });
  }

  /**
   * A simple, honest linear-regression trend over every recorded
   * observation for this resource/metric — not a single-point
   * extrapolation, which is what makes this a real forecast rather than
   * "yesterday's number plus a guess."
   */
  async forecast(resourceId: string, metric: string): Promise<CapacityForecast | null> {
    const observations = await (prisma as any).capacityObservation.findMany({
      where: { resourceId, metric },
      orderBy: { observedAt: "asc" },
    });
    if (observations.length < 2) return null;

    const t0 = new Date(observations[0].observedAt).getTime();
    const points = observations.map((o: any) => ({
      xDays: (new Date(o.observedAt).getTime() - t0) / (24 * 60 * 60 * 1000),
      y: o.value,
    }));

    const n = points.length;
    const sumX = points.reduce((s: number, p: any) => s + p.xDays, 0);
    const sumY = points.reduce((s: number, p: any) => s + p.y, 0);
    const sumXY = points.reduce((s: number, p: any) => s + p.xDays * p.y, 0);
    const sumXX = points.reduce((s: number, p: any) => s + p.xDays * p.xDays, 0);
    const denominator = n * sumXX - sumX * sumX;
    const slope = denominator === 0 ? 0 : (n * sumXY - sumX * sumY) / denominator;
    const intercept = (sumY - slope * sumX) / n;

    const latest = observations[observations.length - 1];
    const capacity = latest.capacity;
    const latestXDays = points[points.length - 1].xDays;

    let daysUntilShortfall: number | null = null;
    let projectedShortfallAt: Date | null = null;
    if (slope > 0) {
      const shortfallXDays = (capacity - intercept) / slope;
      const remaining = shortfallXDays - latestXDays;
      if (remaining >= 0) {
        daysUntilShortfall = remaining;
        projectedShortfallAt = new Date(t0 + shortfallXDays * 24 * 60 * 60 * 1000);
      }
    }

    return {
      resourceId,
      metric,
      trendPerDay: slope,
      latestValue: latest.value,
      capacity,
      daysUntilShortfall,
      projectedShortfallAt,
    };
  }

  /**
   * The exit criterion's central act: a shortfall predicted inside the
   * lookahead window "raises before it is hit" — recorded as an audit
   * entry BEFORE `projectedShortfallAt`, proven by the caller checking
   * `new Date() < projectedShortfallAt` at the moment this returns.
   */
  async checkAndAlert(resourceId: string, metric: string, lookaheadDays = DEFAULT_LOOKAHEAD_DAYS): Promise<CapacityForecast | null> {
    const forecast = await this.forecast(resourceId, metric);
    if (!forecast || forecast.daysUntilShortfall === null) return forecast;
    if (forecast.daysUntilShortfall > lookaheadDays) return forecast;

    await this.audit.record({
      actorId: "system:capacity-forecast",
      actorRole: "system",
      action: "capacity.shortfall-predicted",
      targetId: resourceId,
      details: {
        metric,
        daysUntilShortfall: forecast.daysUntilShortfall,
        projectedShortfallAt: forecast.projectedShortfallAt,
        trendPerDay: forecast.trendPerDay,
      },
    });

    return forecast;
  }

  /**
   * Compiles and runs a scaling plan through the exact same pipeline
   * every other Track M change uses (M09 plan, M12 durable job) — never
   * a bespoke "just increase the number" write.
   */
  async proposeScalingPlan(resourceId: string, newCapacity: number): Promise<{ plan: Plan; jobStatus: string }> {
    const plan = await this.planning.createPlan(resourceId, { capacity: newCapacity });
    const job = await this.executor.startJob(
      `capacity-scale-${resourceId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      plan.id,
      resourceId,
      [
        {
          name: "apply-capacity",
          run: async () => {
            await this.resources.setDesiredState(resourceId, { capacity: newCapacity });
            return { capacity: newCapacity };
          },
        },
      ],
    );
    return { plan, jobStatus: job.status };
  }
}
