import {
  BadRequestException,
  Controller,
  Get,
  Headers,
  Param,
  ParseIntPipe,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import { z } from "zod";
import { Permissions } from "../../common/decorators/permissions.decorator";
import { ZodBody } from "../../common/decorators/zod-body.decorator";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RbacGuard } from "../../common/guards/rbac.guard";
import { RequireIdempotencyKey } from "../../common/idempotency/require-idempotency-key.decorator";
import { ArtifactRevisionsService, type ArtifactScope } from "./artifact-revisions.service";
import { DeveloperAuthorizationService } from "./developer-authorization.service";

interface AuthenticatedRequest extends Request {
  user: { tenantId: string; userId: string; email: string; roles: string[] };
}

const revisionBody = z.object({ source: z.record(z.unknown()) });

function expectedRevision(ifMatch: string | undefined): number {
  const match = ifMatch?.match(/^(?:W\/)?"?(\d+)"?$/);
  if (!match) {
    throw new BadRequestException("If-Match must contain the expected numeric revision");
  }
  return Number(match[1]);
}

@ApiTags("developer-platform-artifacts")
@ApiBearerAuth()
@Controller("dev")
@UseGuards(JwtAuthGuard, RbacGuard)
export class ArtifactRevisionsController {
  constructor(private readonly revisions: ArtifactRevisionsService, private readonly authorization: DeveloperAuthorizationService) {}

  @Get("library/artifacts/:artifactId/revisions")
  @Permissions("builder.read")
  listLibrary(@Req() req: AuthenticatedRequest, @Param("artifactId") artifactId: string) {
    return this.revisions.list(req.user.tenantId, artifactId, { kind: "LIBRARY" });
  }

  @Get("library/artifacts/:artifactId/revisions/:revision")
  @Permissions("builder.read")
  getLibrary(
    @Req() req: AuthenticatedRequest,
    @Param("artifactId") artifactId: string,
    @Param("revision", ParseIntPipe) revision: number,
  ) {
    return this.revisions.get(req.user.tenantId, artifactId, revision, { kind: "LIBRARY" });
  }

  @Post("library/artifacts/:artifactId/revisions")
  @Permissions("builder.write")
  @RequireIdempotencyKey()
  @ApiOperation({ summary: "Create an immutable Library artifact revision" })
  createLibrary(
    @Req() req: AuthenticatedRequest,
    @Param("artifactId") artifactId: string,
    @Headers("if-match") ifMatch: string | undefined,
    @ZodBody(revisionBody) body: z.infer<typeof revisionBody>,
  ) {
    return this.revisions.create({
      tenantId: req.user.tenantId,
      artifactId,
      scope: { kind: "LIBRARY" },
      expectedRevision: expectedRevision(ifMatch),
      source: body.source,
      createdBy: req.user.userId,
    });
  }

  @Get("projects/:projectId/artifacts/:artifactId/revisions")
  @Permissions("builder.read")
  async listProject(
    @Req() req: AuthenticatedRequest,
    @Param("projectId") projectId: string,
    @Param("artifactId") artifactId: string,
  ) {
    await this.authorization.assertProjectAction(req.user.tenantId, projectId, req.user, "AUTHOR");
    return this.revisions.list(req.user.tenantId, artifactId, this.project(projectId));
  }

  @Get("projects/:projectId/artifacts/:artifactId/revisions/:revision")
  @Permissions("builder.read")
  async getProject(
    @Req() req: AuthenticatedRequest,
    @Param("projectId") projectId: string,
    @Param("artifactId") artifactId: string,
    @Param("revision", ParseIntPipe) revision: number,
  ) {
    await this.authorization.assertProjectAction(req.user.tenantId, projectId, req.user, "AUTHOR");
    return this.revisions.get(req.user.tenantId, artifactId, revision, this.project(projectId));
  }

  @Post("projects/:projectId/artifacts/:artifactId/revisions")
  @Permissions("builder.write")
  @RequireIdempotencyKey()
  @ApiOperation({ summary: "Create an immutable project artifact revision" })
  async createProject(
    @Req() req: AuthenticatedRequest,
    @Param("projectId") projectId: string,
    @Param("artifactId") artifactId: string,
    @Headers("if-match") ifMatch: string | undefined,
    @ZodBody(revisionBody) body: z.infer<typeof revisionBody>,
  ) {
    await this.authorization.assertProjectAction(req.user.tenantId, projectId, req.user, "AUTHOR");
    return this.revisions.create({
      tenantId: req.user.tenantId,
      artifactId,
      scope: this.project(projectId),
      expectedRevision: expectedRevision(ifMatch),
      source: body.source,
      createdBy: req.user.userId,
    });
  }

  private project(projectId: string): ArtifactScope {
    return { kind: "PROJECT", projectId };
  }
}
