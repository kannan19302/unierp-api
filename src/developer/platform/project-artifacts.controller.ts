import { Controller, Get, Query, Param, Req, UseGuards } from "@nestjs/common";
import { ApiTags, ApiOperation, ApiBearerAuth } from "@nestjs/swagger";
import { Request } from "express";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RbacGuard } from "../../common/guards/rbac.guard";
import { Permissions } from "../../common/decorators/permissions.decorator";
import { ArtifactRegistryService } from "./artifact-registry.service";
import { DeveloperAuthorizationService } from "./developer-authorization.service";
import { deprecationUsage } from "../../common/versioning/deprecation-usage";

interface AuthenticatedRequest extends Request {
  user: { tenantId: string; userId: string; email: string; roles: string[] };
}

/**
 * Project-scoped artifact listing — the read side of "enter an app, see only
 * its artifacts", which is the requirement the whole project-first reshape
 * exists to satisfy.
 *
 * Scoped to `/dev/projects/:projectId/artifacts` rather than
 * `/apps/:appId/...` on purpose: `DevProject` is one id space over both Apps
 * and Sites, so one route serves both and there is no second copy to keep in
 * step. The full per-builder split under `/apps/:appId/<builder>` is P4.
 */
@ApiTags("developer-platform")
@ApiBearerAuth()
@Controller("dev")
@UseGuards(JwtAuthGuard, RbacGuard)
export class ProjectArtifactsController {
  constructor(private readonly registry: ArtifactRegistryService, private readonly authorization: DeveloperAuthorizationService) {}

  /**
   * Declared BEFORE the `projects/:projectId/...` route below. Nest matches
   * in declaration order, and while these two happen not to collide today,
   * ordering the literal path first is the habit that keeps a future
   * `projects/<something>` from being swallowed by the parameterised route.
   */
  @ApiOperation({ summary: "Registry drift: artifacts missing a registry row" })
  @Get("artifacts/reconcile")
  @Permissions("builder.manage")
  async reconcile(@Req() req: AuthenticatedRequest) {
    return this.registry.reconcile(req.user.tenantId);
  }

  /**
   * Who is still calling the deprecated `/builder/*` surface — plan phase P4
   * stage 2, and the gate the P8 contract migration reads.
   *
   * Deliberately NOT tenant-filtered: the question this answers is "is it
   * safe to remove the legacy routes for everyone", which is a platform
   * decision, hence `builder.manage`. Counts are per-process and in-memory
   * (see `deprecation-usage.ts` for why), so read this from every replica
   * before concluding anything is unused.
   */
  @ApiOperation({ summary: "Deprecated-surface usage, for setting a sunset date" })
  @Get("deprecations/usage")
  @Permissions("builder.manage")
  async deprecationUsage() {
    return {
      note: "Per-process, in-memory since last restart. Check every replica before treating a zero as evidence of disuse.",
      rows: deprecationUsage(),
    };
  }

  @ApiOperation({ summary: "Artifacts visible in this project (owned + attached)" })
  @Get("projects/:projectId/artifacts")
  @Permissions("builder.read")
  async list(
    @Req() req: AuthenticatedRequest,
    @Param("projectId") projectId: string,
    @Query("type") type?: string,
  ) {
    await this.authorization.assertProjectAction(req.user.tenantId, projectId, req.user, "AUTHOR");
    return this.registry.listForProject(req.user.tenantId, projectId, type);
  }
}
