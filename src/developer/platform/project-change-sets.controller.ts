import { Controller, Get, Param, Post, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import { z } from "zod";
import { Permissions } from "../../common/decorators/permissions.decorator";
import { ZodBody } from "../../common/decorators/zod-body.decorator";
import { RequireIdempotencyKey } from "../../common/idempotency/require-idempotency-key.decorator";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RbacGuard } from "../../common/guards/rbac.guard";
import { DeveloperAuthorizationService } from "./developer-authorization.service";
import { ProjectChangeSetsService } from "./project-change-sets.service";

interface AuthenticatedRequest extends Request { user: { tenantId: string; userId: string; roles: string[] } }
const createSchema = z.object({ branch: z.string().regex(/^[A-Za-z0-9._/-]{1,160}$/), title: z.string().min(3).max(240), description: z.string().max(4000).optional(), bundle: z.unknown() });
const reviewSchema = z.object({ decision: z.enum(["APPROVED", "REJECTED"]), comment: z.string().max(4000).optional() });

@ApiTags("developer-platform-changesets") @ApiBearerAuth() @Controller("dev/projects") @UseGuards(JwtAuthGuard, RbacGuard)
export class ProjectChangeSetsController {
  constructor(private readonly changes: ProjectChangeSetsService, private readonly authorization: DeveloperAuthorizationService) {}
  @Get(":projectId/change-sets") @Permissions("builder.read") async list(@Req() req: AuthenticatedRequest, @Param("projectId") projectId: string) { await this.authorization.assertProjectAction(req.user.tenantId, projectId, req.user, "AUTHOR"); return this.changes.list(req.user.tenantId, projectId); }
  @Post(":projectId/change-sets") @Permissions("builder.write") @RequireIdempotencyKey() async create(@Req() req: AuthenticatedRequest, @Param("projectId") projectId: string, @ZodBody(createSchema) body: z.infer<typeof createSchema>) { await this.authorization.assertProjectAction(req.user.tenantId, projectId, req.user, "AUTHOR"); return this.changes.create({ branch: body.branch, title: body.title, description: body.description, bundle: body.bundle as unknown, tenantId: req.user.tenantId, projectId, createdBy: req.user.userId }); }
  @Post(":projectId/change-sets/:id/submit") @Permissions("builder.write") @RequireIdempotencyKey() async submit(@Req() req: AuthenticatedRequest, @Param("projectId") projectId: string, @Param("id") id: string) { await this.authorization.assertProjectAction(req.user.tenantId, projectId, req.user, "AUTHOR"); return this.changes.submit(req.user.tenantId, projectId, id, req.user.userId); }
  @Post(":projectId/change-sets/:id/reviews") @Permissions("builder.manage") @RequireIdempotencyKey() async review(@Req() req: AuthenticatedRequest, @Param("projectId") projectId: string, @Param("id") id: string, @ZodBody(reviewSchema) body: z.infer<typeof reviewSchema>) { await this.authorization.assertProjectAction(req.user.tenantId, projectId, req.user, "RELEASE"); return this.changes.review({ ...body, tenantId: req.user.tenantId, projectId, id, reviewerId: req.user.userId }); }
  @Post(":projectId/change-sets/:id/merge") @Permissions("builder.write") @RequireIdempotencyKey() @ApiOperation({ summary: "Merge an approved hash-pinned source changeset when its base remains current" }) async merge(@Req() req: AuthenticatedRequest, @Param("projectId") projectId: string, @Param("id") id: string) { await this.authorization.assertProjectAction(req.user.tenantId, projectId, req.user, "RELEASE"); return this.changes.merge({ tenantId: req.user.tenantId, projectId, id, mergedBy: req.user.userId }); }
}
