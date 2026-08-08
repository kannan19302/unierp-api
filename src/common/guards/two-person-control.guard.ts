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

      // Mark token as USED
      await (prisma as any).controlPlaneApproval.update({
        where: { id: approvalToken },
        data: { status: "USED" },
      });

      // Optionally, we could record an audit event here, but the actual controller
      // mutation should be the one to emit the business-level audit record. We just
      // pass through. We might attach the token ID to the request for the controller.
      return true;
    }

    if (breakGlassReason) {
      if (breakGlassReason.trim().length < 10) {
        throw new ForbiddenException("Break-glass reason must be at least 10 characters");
      }

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
