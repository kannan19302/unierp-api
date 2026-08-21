import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ApiTags, ApiOperation, ApiBearerAuth } from "@nestjs/swagger";
import { Request } from "express";
import { z } from "zod";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RbacGuard } from "../../common/guards/rbac.guard";
import { Permissions } from "../../common/decorators/permissions.decorator";
import { ZodBody } from "../../common/decorators/zod-body.decorator";
import { ArtifactRegistryService } from "./artifact-registry.service";

interface AuthenticatedRequest extends Request {
  user: { tenantId: string; userId: string; email: string; roles: string[] };
}

const attachSchema = z.object({
  projectIds: z.array(z.string().min(1)).min(1),
});

/**
 * `/api/v1/library/*` — the Library plane, plan phase P3.
 *
 * This is the surface that finally makes "Library" mean what the UI has been
 * claiming: artifacts with no owning project. Before `BuilderArtifact`
 * existed, `/library/forms` in the frontend showed every form the tenant
 * owned, because tenant-wide was the only scope the legacy `/builder/*`
 * routes had.
 */
@ApiTags("developer-platform")
@ApiBearerAuth()
@Controller("library")
@UseGuards(JwtAuthGuard, RbacGuard)
export class LibraryController {
  constructor(private readonly registry: ArtifactRegistryService) {}

  @ApiOperation({ summary: "Unowned artifacts, optionally filtered by type" })
  @Get()
  @Permissions("builder.read")
  async list(
    @Req() req: AuthenticatedRequest,
    @Query("type") type?: string,
  ) {
    return this.registry.listLibrary(req.user.tenantId, type);
  }

  @ApiOperation({ summary: "Which projects this artifact is published into" })
  @Get(":artifactId/attachments")
  @Permissions("builder.read")
  async attachments(
    @Req() req: AuthenticatedRequest,
    @Param("artifactId") artifactId: string,
  ) {
    return this.registry.attachmentsOf(req.user.tenantId, artifactId);
  }

  @ApiOperation({ summary: "Publish a library artifact into one or more apps" })
  @Post(":artifactId/publish-to")
  @Permissions("builder.write")
  async publishTo(
    @Req() req: AuthenticatedRequest,
    @Param("artifactId") artifactId: string,
    @ZodBody(attachSchema) body: z.infer<typeof attachSchema>,
  ) {
    // Sequential, not Promise.all: each attach validates the artifact and the
    // project, and a partial failure should stop rather than leave some
    // projects attached and others not with no indication of which.
    const results: Awaited<ReturnType<ArtifactRegistryService["attach"]>>[] = [];
    for (const projectId of body.projectIds) {
      results.push(
        await this.registry.attach({
          tenantId: req.user.tenantId,
          artifactId,
          projectId,
          attachedBy: req.user.userId,
        }),
      );
    }
    return results;
  }

  @ApiOperation({ summary: "Unpublish a library artifact from an app" })
  @Delete(":artifactId/publish-to/:projectId")
  @Permissions("builder.write")
  async unpublish(
    @Req() req: AuthenticatedRequest,
    @Param("artifactId") artifactId: string,
    @Param("projectId") projectId: string,
  ) {
    return this.registry.detach(req.user.tenantId, artifactId, projectId);
  }
}
