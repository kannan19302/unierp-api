import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from "@nestjs/common";
import { ApiTags, ApiBearerAuth } from "@nestjs/swagger";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RbacGuard } from "../../common/guards/rbac.guard";
import { ControlPlaneGuard } from "../../common/guards/control-plane.guard";
import { SkipTenantScope } from "../../common/decorators/skip-tenant-scope.decorator";
import { Permissions } from "../../common/decorators/permissions.decorator";
import { ControlPlaneApprovalsService } from "./control-plane-approvals.service";

interface AuthenticatedRequest {
  user: { userId?: string; sub?: string };
}

/**
 * C04 / D049 — the approval-request surface. Before this controller existed,
 * `ControlPlaneApproval` had a schema, a consumer in `TwoPersonControlGuard`,
 * and zero producers: nothing anywhere ever created a row, so the approval
 * path of two-person control could never be satisfied by anyone, and every
 * `@TwoPersonControl()` endpoint reduced to single-operator break-glass.
 *
 * `/decide` deliberately does not trust a `decidedBy` field in the request
 * body — it takes the caller's own identity from the verified session, the
 * same way every other plane-1 mutation does, so the two-person separation
 * this whole surface exists for cannot be spoofed by whoever holds the
 * approval id.
 */
@ApiTags("admin")
@ApiBearerAuth()
@Controller("platform/v1/approvals")
@SkipTenantScope()
@UseGuards(JwtAuthGuard, RbacGuard, ControlPlaneGuard)
export class ControlPlaneApprovalsController {
  constructor(private readonly approvals: ControlPlaneApprovalsService) {}

  @Post()
  @Permissions("system.approval.request")
  request(
    @Req() req: AuthenticatedRequest,
    @Body() body: { requestedAction: string; targetId?: string },
  ) {
    return this.approvals.request({
      requestedBy: (req as any).user.userId ?? (req as any).user.sub,
      requestedAction: body.requestedAction,
      targetId: body.targetId ?? null,
    });
  }

  @Post(":id/approve")
  @Permissions("system.approval.decide")
  approve(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    return this.approvals.decide(
      id,
      (req as any).user.userId ?? (req as any).user.sub,
      "APPROVED",
    );
  }

  @Post(":id/reject")
  @Permissions("system.approval.decide")
  reject(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    return this.approvals.decide(
      id,
      (req as any).user.userId ?? (req as any).user.sub,
      "REJECTED",
    );
  }

  @Get("review-tasks")
  @Permissions("system.approval.read")
  listReviewTasks(@Query("status") status?: "OPEN" | "REVIEWED") {
    return this.approvals.listReviewTasks(status);
  }

  @Post("review-tasks/:id/review")
  @Permissions("system.approval.decide")
  reviewTask(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() body: { notes?: string },
  ) {
    return this.approvals.markReviewed(
      id,
      (req as any).user.userId ?? (req as any).user.sub,
      body.notes,
    );
  }
}
