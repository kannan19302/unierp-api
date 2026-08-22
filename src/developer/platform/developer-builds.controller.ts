import { Controller, Get, Param, Post, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import { Permissions } from "../../common/decorators/permissions.decorator";
import { RequireIdempotencyKey } from "../../common/idempotency/require-idempotency-key.decorator";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RbacGuard } from "../../common/guards/rbac.guard";
import { DeveloperAuthorizationService } from "./developer-authorization.service";
import { DeveloperBuildsService } from "./developer-builds.service";

interface AuthenticatedRequest extends Request { user: { tenantId: string; userId: string; roles: string[] } }

@ApiTags("developer-platform-builds")
@ApiBearerAuth()
@Controller("dev/projects")
@UseGuards(JwtAuthGuard, RbacGuard)
export class DeveloperBuildsController {
  constructor(private readonly builds: DeveloperBuildsService, private readonly authorization: DeveloperAuthorizationService) {}

  @Get(":projectId/build-jobs")
  @Permissions("builder.read")
  async list(@Req() req: AuthenticatedRequest, @Param("projectId") projectId: string) {
    await this.authorization.assertProjectAction(req.user.tenantId, projectId, req.user, "AUTHOR");
    return this.builds.list(req.user.tenantId, projectId);
  }

  @Post(":projectId/build-jobs")
  @Permissions("builder.write")
  @RequireIdempotencyKey()
  @ApiOperation({ summary: "Queue durable project validation/build work" })
  async enqueue(@Req() req: AuthenticatedRequest, @Param("projectId") projectId: string) {
    await this.authorization.assertProjectAction(req.user.tenantId, projectId, req.user, "AUTHOR");
    return this.builds.enqueue({ tenantId: req.user.tenantId, projectId, startedBy: req.user.userId });
  }
}
