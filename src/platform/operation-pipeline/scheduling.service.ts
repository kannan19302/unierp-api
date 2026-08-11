import { BadRequestException, Injectable } from "@nestjs/common";
import { prisma } from "@kannan19302/database";
import type { Plan } from "./planning.service";
import { ControlPlaneApprovalsService } from "../v1/control-plane-approvals.service";

/**
 * M11 — approvals, two-person control and scheduling.
 *
 * Approval routing reuses C04's own mechanism — `ControlPlaneApprovalsService`
 * (built in M49 to close D049) and the `ControlPlaneApproval` table it owns
 * — rather than a second approval model for the pipeline. `requestApproval`
 * and `decideApproval` below are thin pass-throughs; the actual separation
 * rule ("the requesting operator cannot also approve their own request")
 * lives in exactly one place, `ControlPlaneApprovalsService.decide()`, and
 * this phase's own exit criterion requires proving that: removing C04's
 * guard must break THIS phase's test too, which only holds if this file
 * calls the real thing rather than reimplementing the check.
 */
@Injectable()
export class SchedulingService {
  constructor(private readonly approvals: ControlPlaneApprovalsService) {}

  /** A destructive plan requests approval the same way any other C04
   *  approval is requested — through the one producer M49 built. */
  async requestApproval(plan: Plan, requestedBy: string) {
    return this.approvals.request({
      requestedBy,
      requestedAction: `plan.execute:${plan.resourceId}`,
      targetId: plan.resourceId,
    });
  }

  /**
   * "A destructive plan cannot execute on one operator's approval" — this
   * calls C04's `decide()` directly. If `decidedBy === requestedBy`, that
   * method throws; nothing here catches or works around it.
   */
  async decideApproval(approvalId: string, decidedBy: string, decision: "APPROVED" | "REJECTED") {
    return this.approvals.decide(approvalId, decidedBy, decision);
  }

  /**
   * "A plan scheduled into a blackout window is refused at schedule time,
   * not at run time" — the blackout check runs here, before the
   * ScheduledOperation row is even created, so an operator finds out
   * immediately rather than when the scheduled time arrives and the
   * operation silently never runs (or worse, runs anyway).
   */
  async scheduleOperation(
    plan: Plan,
    scheduledFor: Date,
    options?: { recurrence?: string; approvalId?: string },
  ) {
    const blackout = await this.findActiveBlackout(scheduledFor);
    if (blackout) {
      throw new BadRequestException(
        `Cannot schedule for ${scheduledFor.toISOString()}: falls within blackout period "${blackout.reason}" ` +
          `(${blackout.startTime.toISOString()} – ${blackout.endTime.toISOString()})`,
      );
    }

    return (prisma as any).scheduledOperation.create({
      data: {
        planId: plan.id,
        resourceId: plan.resourceId,
        scheduledFor,
        recurrence: options?.recurrence ?? null,
        approvalId: options?.approvalId ?? null,
      },
    });
  }

  async createBlackoutPeriod(reason: string, startTime: Date, endTime: Date) {
    if (endTime <= startTime) {
      throw new BadRequestException("A blackout period's endTime must be after its startTime");
    }
    return (prisma as any).blackoutPeriod.create({ data: { reason, startTime, endTime } });
  }

  private async findActiveBlackout(at: Date): Promise<{ reason: string; startTime: Date; endTime: Date } | null> {
    const windows = await (prisma as any).blackoutPeriod.findMany({
      where: { startTime: { lte: at }, endTime: { gte: at } },
    });
    return windows[0] ?? null;
  }
}
