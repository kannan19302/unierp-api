import { Controller, Get, Param, Post, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import { Permissions } from "../../common/decorators/permissions.decorator";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RbacGuard } from "../../common/guards/rbac.guard";
import { RequireIdempotencyKey } from "../../common/idempotency/require-idempotency-key.decorator";
import { DeveloperAuthorizationService } from "./developer-authorization.service";
import { ProjectTestRunsService } from "./project-test-runs.service";
interface AuthenticatedRequest extends Request { user: { tenantId: string; userId: string; roles: string[] } }
@ApiTags("developer-platform-tests") @ApiBearerAuth() @Controller("dev/projects") @UseGuards(JwtAuthGuard, RbacGuard)
export class ProjectTestRunsController {
  constructor(private readonly tests: ProjectTestRunsService, private readonly authorization: DeveloperAuthorizationService) {}
  @Get(":projectId/test-runs") @Permissions("builder.read")
  async list(@Req() req: AuthenticatedRequest, @Param("projectId") projectId: string) { await this.authorization.assertProjectAction(req.user.tenantId, projectId, req.user, "AUTHOR"); return this.tests.list(req.user.tenantId, projectId); }
  @Post(":projectId/test-runs") @Permissions("builder.write") @RequireIdempotencyKey() @ApiOperation({ summary: "Run project test suites against the exact immutable composition" })
  async run(@Req() req: AuthenticatedRequest, @Param("projectId") projectId: string) { await this.authorization.assertProjectAction(req.user.tenantId, projectId, req.user, "AUTHOR"); return this.tests.run({ tenantId: req.user.tenantId, projectId, startedBy: req.user.userId }); }
}
