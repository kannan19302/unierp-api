import { Controller, Get, Param, Post, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import { Permissions } from "../../common/decorators/permissions.decorator";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RbacGuard } from "../../common/guards/rbac.guard";
import { RuntimeManifestService } from "./runtime-manifest.service";
import { DeveloperAuthorizationService } from "./developer-authorization.service";
import { RequireIdempotencyKey } from "../../common/idempotency/require-idempotency-key.decorator";
import { ZodBody } from "../../common/decorators/zod-body.decorator";
import { z } from "zod";

interface AuthenticatedRequest extends Request { user: { tenantId: string; userId: string; roles: string[] } }
const runtimeSubmissionSchema = z.object({ formArtifactId: z.string().min(1).max(200), values: z.record(z.string(), z.unknown()).refine((value) => Object.keys(value).length <= 64, "At most 64 fields may be submitted") });
@ApiTags("developer-platform-runtime")
@ApiBearerAuth()
@Controller("dev/runtime")
@UseGuards(JwtAuthGuard, RbacGuard)
export class RuntimeManifestController {
  constructor(private readonly runtime: RuntimeManifestService, private readonly authorization: DeveloperAuthorizationService) {}
  @Get("environments/:environmentId/projects/:projectId/manifest")
  @Permissions("builder.read")
  @ApiOperation({ summary: "Resolve the active immutable runtime manifest for a project environment" })
  async resolve(@Req() req: AuthenticatedRequest, @Param("environmentId") environmentId: string, @Param("projectId") projectId: string) {
    await this.authorization.assertProjectAction(req.user.tenantId, projectId, req.user, "RUNTIME");
    return this.runtime.resolve({ tenantId: req.user.tenantId, environmentId, projectId });
  }
  @Post("environments/:environmentId/projects/:projectId/submissions")
  @Permissions("builder.record.create")
  @RequireIdempotencyKey()
  @ApiOperation({ summary: "Create a typed record through the active signed runtime composition" })
  async submit(@Req() req: AuthenticatedRequest, @Param("environmentId") environmentId: string, @Param("projectId") projectId: string, @ZodBody(runtimeSubmissionSchema) body: z.infer<typeof runtimeSubmissionSchema>) {
    await this.authorization.assertProjectAction(req.user.tenantId, projectId, req.user, "RUNTIME");
    return this.runtime.submit({ tenantId: req.user.tenantId, environmentId, projectId, ...body, createdBy: req.user.userId });
  }
}
