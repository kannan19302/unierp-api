import { Controller, Param, Post, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import { z } from "zod";
import { Permissions } from "../../common/decorators/permissions.decorator";
import { ZodBody } from "../../common/decorators/zod-body.decorator";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RbacGuard } from "../../common/guards/rbac.guard";
import { DeveloperAuthorizationService } from "./developer-authorization.service";
import { ProjectSourceImportService } from "./project-source-import.service";
import { RequireIdempotencyKey } from "../../common/idempotency/require-idempotency-key.decorator";
interface AuthenticatedRequest extends Request { user: { tenantId: string; userId: string; roles: string[] } }
@ApiTags("developer-platform-source") @ApiBearerAuth() @Controller("dev/projects") @UseGuards(JwtAuthGuard, RbacGuard)
export class ProjectSourceImportController {
  constructor(private readonly source: ProjectSourceImportService, private readonly authorization: DeveloperAuthorizationService) {}
  @Post(":projectId/source-import/plan") @Permissions("builder.write") @ApiOperation({ summary: "Validate a canonical source bundle and calculate governed revision impact" })
  async plan(@Req() req: AuthenticatedRequest, @Param("projectId") projectId: string, @ZodBody(z.object({ bundle: z.unknown() })) body: { bundle: unknown }) { await this.authorization.assertProjectAction(req.user.tenantId, projectId, req.user, "AUTHOR"); return this.source.plan(req.user.tenantId, projectId, body.bundle); }
  @Post(":projectId/source-import/apply") @Permissions("builder.write") @RequireIdempotencyKey() @ApiOperation({ summary: "Atomically apply confirmed existing-artifact source revisions" })
  async apply(@Req() req: AuthenticatedRequest, @Param("projectId") projectId: string, @ZodBody(z.object({ bundle: z.unknown(), confirmed: z.literal(true), resolutions: z.record(z.string(), z.union([z.enum(["KEEP_CURRENT", "APPLY_INCOMING"]), z.object({ action: z.enum(["KEEP_CURRENT", "APPLY_INCOMING"]), approvedBreaking: z.boolean().optional(), resourceMappings: z.record(z.string(), z.unknown()).optional(), capabilityGrants: z.array(z.unknown()).optional() })])).default({}) })) body: { bundle: unknown; confirmed: true; resolutions: Record<string, any> }) { await this.authorization.assertProjectAction(req.user.tenantId, projectId, req.user, "AUTHOR"); return this.source.apply(req.user.tenantId, projectId, body.bundle, req.user.userId, body.resolutions); }
}
