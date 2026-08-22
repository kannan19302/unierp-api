import { Controller, Get, Post, Param, Req, UseGuards } from "@nestjs/common";
import { ApiTags, ApiOperation, ApiBearerAuth } from "@nestjs/swagger";
import { Request } from "express";
import { z } from "zod";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RbacGuard } from "../../common/guards/rbac.guard";
import { Permissions } from "../../common/decorators/permissions.decorator";
import { ZodBody } from "../../common/decorators/zod-body.decorator";
import { RequireIdempotencyKey } from "../../common/idempotency/require-idempotency-key.decorator";
import { ProjectReleasesService } from "./project-releases.service";
import { ArtifactRegistryService } from "./artifact-registry.service";
import { DeveloperAuthorizationService } from "./developer-authorization.service";

interface AuthenticatedRequest extends Request {
  user: { tenantId: string; userId: string; email: string; roles: string[] };
}

const publishSchema = z.object({
  version: z.string().regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/),
  changelog: z.string().optional(),
  keyId: z.string().min(1),
  signature: z.string().min(1),
  releaseId: z.string().min(1).optional(),
  policyBundleVersion: z.string().min(1).optional(),
});

const preparePublishSchema = publishSchema.omit({ keyId: true, signature: true });

const rollbackSchema = z.object({
  targetReleaseId: z.string().min(1),
});

const deploymentSchema = z.object({
  releaseId: z.string().min(1),
  environmentId: z.string().min(1),
  strategy: z.enum(["ROLLING", "BLUE_GREEN", "CANARY", "RECREATE"]).default("ROLLING"),
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
    private readonly authorization: DeveloperAuthorizationService,
  ) {}

  @ApiOperation({ summary: "Release history for a project" })
  @Get(":projectId/releases")
  @Permissions("builder.read")
  async list(@Req() req: AuthenticatedRequest, @Param("projectId") projectId: string) {
    return this.releases.list(req.user.tenantId, projectId);
  }

  @ApiOperation({ summary: "Validation history for exact project compositions" })
  @Get(":projectId/validations")
  @Permissions("builder.read")
  async validations(@Req() req: AuthenticatedRequest, @Param("projectId") projectId: string) {
    return this.releases.listValidations(req.user.tenantId, projectId);
  }

  @ApiOperation({ summary: "Validate and deterministically compile the current project composition" })
  @Post(":projectId/validations")
  @Permissions("builder.write")
  @RequireIdempotencyKey()
  async validate(@Req() req: AuthenticatedRequest, @Param("projectId") projectId: string) {
    await this.authorization.assertProjectAction(req.user.tenantId, projectId, req.user, "AUTHOR");
    return this.releases.validate({ tenantId: req.user.tenantId, projectId, startedBy: req.user.userId });
  }

  @ApiOperation({ summary: "Prepare the exact immutable manifest hash that an external signing key must sign" })
  @Post(":projectId/releases/prepare")
  @Permissions("builder.write")
  @RequireIdempotencyKey()
  async preparePublish(
    @Req() req: AuthenticatedRequest,
    @Param("projectId") projectId: string,
    @ZodBody(preparePublishSchema) body: z.infer<typeof preparePublishSchema>,
  ) {
    await this.authorization.assertProjectAction(req.user.tenantId, projectId, req.user, "RELEASE");
    const prepared = await this.releases.preparePublish({ tenantId: req.user.tenantId, projectId, ...body });
    return { manifest: prepared.unsigned, manifestHash: prepared.manifestHash };
  }

  @ApiOperation({ summary: "Publish the project's current state as a release" })
  @Post(":projectId/releases")
  @Permissions("builder.write")
  @RequireIdempotencyKey()
  async publish(
    @Req() req: AuthenticatedRequest,
    @Param("projectId") projectId: string,
    @ZodBody(publishSchema) body: z.infer<typeof publishSchema>,
  ) {
    await this.authorization.assertProjectAction(req.user.tenantId, projectId, req.user, "RELEASE");
    return this.releases.publish({
      tenantId: req.user.tenantId,
      projectId,
      version: body.version,
      changelog: body.changelog,
      keyId: body.keyId,
      signature: body.signature,
      releaseId: body.releaseId,
      policyBundleVersion: body.policyBundleVersion,
      publishedBy: req.user.userId,
    });
  }

  @ApiOperation({ summary: "Record the authenticated approver's approval for a signed release" })
  @Post(":projectId/releases/:releaseId/approvals")
  @Permissions("builder.manage")
  @RequireIdempotencyKey()
  async approve(@Req() req: AuthenticatedRequest, @Param("projectId") projectId: string, @Param("releaseId") releaseId: string) {
    await this.authorization.assertProjectAction(req.user.tenantId, projectId, req.user, "RELEASE");
    return this.releases.approveRelease({ tenantId: req.user.tenantId, projectId, releaseId, userId: req.user.userId });
  }

  @ApiOperation({ summary: "Deploy an immutable signed release manifest" })
  @Post(":projectId/deployments")
  @Permissions("builder.write")
  @RequireIdempotencyKey()
  async deploy(
    @Req() req: AuthenticatedRequest,
    @Param("projectId") projectId: string,
    @ZodBody(deploymentSchema) body: z.infer<typeof deploymentSchema>,
  ) {
    await this.authorization.assertProjectAction(req.user.tenantId, projectId, req.user, "DEPLOY");
    return this.releases.deploy({
      tenantId: req.user.tenantId,
      projectId,
      releaseId: body.releaseId,
      environmentId: body.environmentId,
      strategy: body.strategy,
      deployedBy: req.user.userId,
    });
  }

  @ApiOperation({ summary: "Roll back by activating a prior immutable release" })
  @Post(":projectId/deployments/:deploymentId/rollback")
  @Permissions("builder.write")
  @RequireIdempotencyKey()
  async rollback(@Req() req: AuthenticatedRequest, @Param("projectId") projectId: string, @Param("deploymentId") deploymentId: string, @ZodBody(rollbackSchema) body: z.infer<typeof rollbackSchema>) {
    await this.authorization.assertProjectAction(req.user.tenantId, projectId, req.user, "DEPLOY");
    return this.releases.rollbackDeployment({ tenantId: req.user.tenantId, projectId, deploymentId, targetReleaseId: body.targetReleaseId, deployedBy: req.user.userId });
  }

  @ApiOperation({
    summary: "Pin an attached artifact to a release, or unpin to follow head",
  })
  @Post(":projectId/artifacts/pin")
  @Permissions("builder.write")
  @RequireIdempotencyKey()
  async pin(
    @Req() req: AuthenticatedRequest,
    @Param("projectId") projectId: string,
    @ZodBody(pinSchema) body: z.infer<typeof pinSchema>,
  ) {
    await this.authorization.assertProjectAction(req.user.tenantId, projectId, req.user, "AUTHOR");
    return this.registry.pin({
      tenantId: req.user.tenantId,
      projectId,
      artifactId: body.artifactId,
      releaseId: body.releaseId,
    });
  }
}
