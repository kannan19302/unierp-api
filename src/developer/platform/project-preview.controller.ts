import { Controller, Delete, Get, Param, Post, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import { z } from "zod";
import { Permissions } from "../../common/decorators/permissions.decorator";
import { ZodBody } from "../../common/decorators/zod-body.decorator";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RbacGuard } from "../../common/guards/rbac.guard";
import { RequireIdempotencyKey } from "../../common/idempotency/require-idempotency-key.decorator";
import { DeveloperAuthorizationService } from "./developer-authorization.service";
import { ProjectPreviewService } from "./project-preview.service";
interface AuthenticatedRequest extends Request { user: { tenantId: string; userId: string; roles: string[] } }
const context = z.object({ role: z.string().max(120).optional(), locale: z.string().max(32).optional(), device: z.enum(["desktop", "tablet", "mobile"]).optional(), fixture: z.string().max(160).optional() }).default({});
@ApiTags("developer-platform-preview") @ApiBearerAuth() @Controller("dev/projects") @UseGuards(JwtAuthGuard, RbacGuard)
export class ProjectPreviewController {
  constructor(private readonly preview: ProjectPreviewService, private readonly authorization: DeveloperAuthorizationService) {}
  @Get(":projectId/previews") @Permissions("builder.read") async list(@Req() req: AuthenticatedRequest, @Param("projectId") projectId: string) { await this.authorization.assertProjectAction(req.user.tenantId, projectId, req.user, "AUTHOR"); return this.preview.list(req.user.tenantId, projectId); }
  @Post(":projectId/previews") @Permissions("builder.write") @RequireIdempotencyKey() @ApiOperation({ summary: "Create a short-lived tenant-isolated preview for the current composition" }) async create(@Req() req: AuthenticatedRequest, @Param("projectId") projectId: string, @ZodBody(context) body: z.infer<typeof context>) { await this.authorization.assertProjectAction(req.user.tenantId, projectId, req.user, "AUTHOR"); return this.preview.create({ tenantId: req.user.tenantId, projectId, context: body, createdBy: req.user.userId }); }
  @Delete(":projectId/previews/:previewId") @Permissions("builder.write") @RequireIdempotencyKey() async revoke(@Req() req: AuthenticatedRequest, @Param("projectId") projectId: string, @Param("previewId") previewId: string) { await this.authorization.assertProjectAction(req.user.tenantId, projectId, req.user, "AUTHOR"); return this.preview.revoke(req.user.tenantId, projectId, previewId); }
}
