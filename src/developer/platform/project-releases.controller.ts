import { Controller, Get, Post, Param, Req, UseGuards } from "@nestjs/common";
import { ApiTags, ApiOperation, ApiBearerAuth } from "@nestjs/swagger";
import { Request } from "express";
import { z } from "zod";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RbacGuard } from "../../common/guards/rbac.guard";
import { Permissions } from "../../common/decorators/permissions.decorator";
import { ZodBody } from "../../common/decorators/zod-body.decorator";
import { ProjectReleasesService } from "./project-releases.service";
import { ArtifactRegistryService } from "./artifact-registry.service";

interface AuthenticatedRequest extends Request {
  user: { tenantId: string; userId: string; email: string; roles: string[] };
}

const publishSchema = z.object({
  version: z.string().min(1),
  changelog: z.string().optional(),
});

const rollbackSchema = z.object({
  releaseId: z.string().min(1),
  version: z.string().min(1),
});

const pinSchema = z.object({
  artifactId: z.string().min(1),
  /** null unpins — back to following head. */
  releaseId: z.string().min(1).nullable(),
});

/** Releases (P6) and attachment pinning (P9), both project-scoped. */
@ApiTags("developer-platform")
@ApiBearerAuth()
@Controller("dev/projects")
@UseGuards(JwtAuthGuard, RbacGuard)
export class ProjectReleasesController {
  constructor(
    private readonly releases: ProjectReleasesService,
    private readonly registry: ArtifactRegistryService,
  ) {}

  @ApiOperation({ summary: "Release history for a project" })
  @Get(":projectId/releases")
  @Permissions("builder.read")
  async list(@Req() req: AuthenticatedRequest, @Param("projectId") projectId: string) {
    return this.releases.list(req.user.tenantId, projectId);
  }

  @ApiOperation({ summary: "Publish the project's current state as a release" })
  @Post(":projectId/releases")
  @Permissions("builder.write")
  async publish(
    @Req() req: AuthenticatedRequest,
    @Param("projectId") projectId: string,
    @ZodBody(publishSchema) body: z.infer<typeof publishSchema>,
  ) {
    return this.releases.publish({
      tenantId: req.user.tenantId,
      projectId,
      version: body.version,
      changelog: body.changelog,
      publishedBy: req.user.userId,
    });
  }

  @ApiOperation({ summary: "Roll back by re-publishing an earlier snapshot" })
  @Post(":projectId/releases/rollback")
  @Permissions("builder.write")
  async rollback(
    @Req() req: AuthenticatedRequest,
    @Param("projectId") projectId: string,
    @ZodBody(rollbackSchema) body: z.infer<typeof rollbackSchema>,
  ) {
    return this.releases.rollbackTo({
      tenantId: req.user.tenantId,
      projectId,
      releaseId: body.releaseId,
      version: body.version,
      publishedBy: req.user.userId,
    });
  }

  @ApiOperation({
    summary: "Pin an attached artifact to a release, or unpin to follow head",
  })
  @Post(":projectId/artifacts/pin")
  @Permissions("builder.write")
  async pin(
    @Req() req: AuthenticatedRequest,
    @Param("projectId") projectId: string,
    @ZodBody(pinSchema) body: z.infer<typeof pinSchema>,
  ) {
    return this.registry.pin({
      tenantId: req.user.tenantId,
      projectId,
      artifactId: body.artifactId,
      releaseId: body.releaseId,
    });
  }
}
