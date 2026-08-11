import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { TWO_PERSON_CONTROL_KEY } from "../decorators/two-person-control.decorator";
import { prisma } from "@kannan19302/database";
import { ControlPlaneAuditService } from "../../platform/v1/control-plane-audit.service";
import { pinoLogger } from "../services/logger.service";
import { Request } from "express";

@Injectable()
export class TwoPersonControlGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private audit: ControlPlaneAuditService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isTwoPersonRequired = this.reflector.getAllAndOverride<boolean>(
      TWO_PERSON_CONTROL_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!isTwoPersonRequired) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const user = (request as any).user;
    if (!user) {
      throw new ForbiddenException("Unauthenticated");
    }

    const actorId = user.userId ?? user.sub;
    const actorRole = user.realm ?? "provider";
    const action = `${request.method} ${request.url}`;
    const approvalToken = request.headers["x-approval-token"] as string;
    const breakGlassReason = request.headers["x-break-glass-reason"] as string;
    const correlationId = request.headers["x-correlation-id"] as string;

    if (approvalToken) {
      // Validate approval token
      const approval = await (prisma as any).controlPlaneApproval.findUnique({
        where: { id: approvalToken },
      });

      if (!approval) {
        throw new ForbiddenException("Invalid approval token");
      }
      if (approval.status !== "APPROVED") {
        throw new ForbiddenException(`Approval token status is ${approval.status}`);
      }
      if (approval.expiresAt < new Date()) {
        throw new ForbiddenException("Approval token expired");
      }
      if (approval.requestedBy !== actorId) {
        throw new ForbiddenException("Approval token issued to different user");
      }
      // C04 / D049: the field this guard exists to check. `status === "APPROVED"`
      // alone does not prove a second person did anything — nothing enforced
      // that `approvedBy` was ever set, or that it differs from `requestedBy`,
      // before this check existed. A single operator who could set their own
      // request's status to APPROVED (or a bug that defaulted it there) passed
      // every prior check in this block. This is the two-person invariant.
      if (!approval.approvedBy) {
        throw new ForbiddenException(
          "Approval token has no recorded approver — it was never actually approved by anyone",
        );
      }
      if (approval.approvedBy === approval.requestedBy) {
        throw new ForbiddenException(
          "Approval must come from a different operator than the one who requested it",
        );
      }

      // Mark token as USED
      await (prisma as any).controlPlaneApproval.update({
        where: { id: approvalToken },
        data: { status: "USED" },
      });

      await this.audit.record({
        actorId,
        actorRole,
        action: "two-person-control.approval-used",
        targetId: approval.targetId ?? null,
        details: { route: action, approvalId: approval.id, approvedBy: approval.approvedBy },
        correlationId,
        ipAddress: request.ip,
      });

      return true;
    }

    if (breakGlassReason) {
      if (breakGlassReason.trim().length < 10) {
        throw new ForbiddenException("Break-glass reason must be at least 10 characters");
      }

      // C04 / D049: "raises an alert" had no notification transport behind it —
      // the review task this block creates had no reader anywhere in the
      // codebase (fixed by control-plane-approvals.controller.ts's
      // GET /review-tasks), and nothing logged the event above routine noise.
      // This does not claim to page anyone; it makes a break-glass use loud
      // in whatever log-based alerting already watches `error`-level lines,
      // which is what this codebase's other genuine security events already
      // rely on (see control-plane.guard.ts's MFA/realm denial logging).
      pinoLogger.error(
        { actorId, actorRole, action, reason: breakGlassReason },
        "control-plane break-glass used — single-operator override of two-person control",
      );

      // Record the break-glass usage as a review task
      await (prisma as any).controlPlaneReviewTask.create({
        data: {
          actorId,
          action,
          targetId: (request.params as any).id ?? null,
          reason: breakGlassReason,
        },
      });

      // Audit the break-glass event
      await this.audit.record({
        actorId,
        actorRole,
        action: "break-glass.used",
        details: { route: action, reason: breakGlassReason },
        correlationId,
        ipAddress: request.ip,
      });

      return true;
    }

    throw new ForbiddenException(
      "Two-person approval or break-glass reason required",
    );
  }
}
