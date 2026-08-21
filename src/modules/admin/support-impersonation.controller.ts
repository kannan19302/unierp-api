import { Body, Controller, Get, Param, Post, Req, UseGuards } from "@nestjs/common";
import { Request } from "express";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RbacGuard } from "../../common/guards/rbac.guard";
import { ControlPlaneGuard } from "../../common/guards/control-plane.guard";
import { Permissions } from "../../common/decorators/permissions.decorator";
import { SkipTenantScope } from "../../common/decorators/skip-tenant-scope.decorator";
import { SupportImpersonationService } from "./support-impersonation.service";

interface AuthenticatedRequest extends Request {
  user: { userId: string; email: string; roles: string[] };
}

/**
 * Provider-side half of the support-access flow: consumes a tenant's
 * `TenantConsent` (granted from `PlatformController.grantSupportConsent`,
 * tenant realm) to start a time-boxed `ImpersonationSession`. Cross-tenant by
 * nature — a control-plane operator reaching into an arbitrary tenant — so it
 * is deliberately excluded from `TenantInterceptor`'s scoping via
 * `@SkipTenantScope()` and, per that decorator's own contract, must enforce
 * its own access control: `ControlPlaneGuard` plus the `platform.support.l2`
 * permission gate below, which is the one role in `CONTROL_PLANE_ROLE` this
 * plan's support-access section names explicitly.
 */
@ApiTags("admin")
@ApiBearerAuth()
@Controller("admin/support-impersonation")
@UseGuards(JwtAuthGuard, RbacGuard, ControlPlaneGuard)
@SkipTenantScope()
export class SupportImpersonationController {
  constructor(private readonly service: SupportImpersonationService) {}

  @ApiOperation({ summary: "Start a consent-gated support impersonation session" })
  @Post(":tenantId/start")
  @Permissions("platform.support.l2")
  async start(
    @Req() req: AuthenticatedRequest,
    @Param("tenantId") tenantId: string,
    @Body("targetUserId") targetUserId: string,
  ) {
    return this.service.start(tenantId, targetUserId, req.user.userId, req.user.email);
  }

  @ApiOperation({ summary: "End an active support impersonation session" })
  @Post(":sessionId/stop")
  @Permissions("platform.support.l2")
  async stop(@Req() req: AuthenticatedRequest, @Param("sessionId") sessionId: string) {
    return this.service.stop(sessionId, req.user.userId, req.user.email);
  }

  @ApiOperation({ summary: "List active support impersonation sessions" })
  @Get("active")
  @Permissions("platform.support.l2")
  async listActive() {
    return this.service.listActive();
  }
}
