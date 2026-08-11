import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { prisma } from "@kannan19302/database";
import { ControlPlaneAuditService } from "./control-plane-audit.service";
import { pinoLogger } from "../../common/services/logger.service";

const APPROVAL_TTL_MS = 30 * 60 * 1000; // 30 minutes — long enough to find a second operator, short enough that a stale approval can't be resurrected days later.

/**
 * C04 / D049 — the approval-request half of two-person control.
 *
 * `TwoPersonControlGuard` validates an approval token; nothing in the
 * codebase ever created one. This service is that missing half: an operator
 * requests approval for a specific destructive action, and a DIFFERENT
 * operator decides it. The guard enforces `approvedBy !== requestedBy` — this
 * service enforces it a second time, at creation, so the constraint holds
 * even for a caller who reads the guard's source and tries to route around it
 * by calling the service directly.
 */
@Injectable()
export class ControlPlaneApprovalsService {
  constructor(private readonly audit: ControlPlaneAuditService) {}

  async request(input: {
    requestedBy: string;
    requestedAction: string;
    targetId?: string | null;
  }) {
    const approval = await (prisma as any).controlPlaneApproval.create({
      data: {
        requestedBy: input.requestedBy,
        requestedAction: input.requestedAction,
        targetId: input.targetId ?? null,
        status: "PENDING",
        expiresAt: new Date(Date.now() + APPROVAL_TTL_MS),
      },
    });

    await this.audit.record({
      actorId: input.requestedBy,
      actorRole: "provider",
      action: "two-person-control.approval-requested",
      targetId: input.targetId ?? null,
      details: { approvalId: approval.id, requestedAction: input.requestedAction },
    });

    return approval;
  }

  async decide(
    approvalId: string,
    decidedBy: string,
    decision: "APPROVED" | "REJECTED",
  ) {
    const approval = await (prisma as any).controlPlaneApproval.findUnique({
      where: { id: approvalId },
    });
    if (!approval) {
      throw new NotFoundException(`Approval ${approvalId} not found`);
    }
    if (approval.status !== "PENDING") {
      throw new ForbiddenException(
        `Approval ${approvalId} is ${approval.status}, not PENDING`,
      );
    }
    if (approval.expiresAt < new Date()) {
      throw new ForbiddenException(`Approval ${approvalId} has expired`);
    }
    // The invariant this whole mechanism exists for. Enforced here as well as
    // in TwoPersonControlGuard, deliberately — two independent checks of the
    // same rule is exactly what "two-person" means applied to the code itself.
    if (decidedBy === approval.requestedBy) {
      throw new ForbiddenException(
        "The requesting operator cannot also approve their own request",
      );
    }

    const updated = await (prisma as any).controlPlaneApproval.update({
      where: { id: approvalId },
      data: { status: decision, approvedBy: decidedBy },
    });

    await this.audit.record({
      actorId: decidedBy,
      actorRole: "provider",
      action: `two-person-control.approval-${decision.toLowerCase()}`,
      targetId: approval.targetId ?? null,
      details: { approvalId, requestedBy: approval.requestedBy },
    });

    return updated;
  }

  /**
   * The other half of "creates a review task": something must be able to
   * read it. `ControlPlaneReviewTask` had no reader anywhere before this —
   * a row nobody could see is not a review.
   */
  async listReviewTasks(status?: "OPEN" | "REVIEWED") {
    return (prisma as any).controlPlaneReviewTask.findMany({
      where: status ? { status } : undefined,
      orderBy: { createdAt: "desc" },
    });
  }

  async markReviewed(taskId: string, reviewedBy: string, notes?: string) {
    const task = await (prisma as any).controlPlaneReviewTask.update({
      where: { id: taskId },
      data: { status: "REVIEWED", reviewedBy, notes },
    });
    // Loud, not silent: a reviewed break-glass event still deserves a record
    // that someone looked at it, distinct from the original loud log line
    // TwoPersonControlGuard emits when break-glass is first used.
    pinoLogger.warn(
      { taskId, reviewedBy },
      "control-plane break-glass review task marked reviewed",
    );
    return task;
  }
}
