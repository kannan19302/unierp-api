import { Controller, Delete, Get, Param, Post, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import { z } from "zod";
import { Permissions } from "../../common/decorators/permissions.decorator";
import { ZodBody } from "../../common/decorators/zod-body.decorator";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RbacGuard } from "../../common/guards/rbac.guard";
import { RequireIdempotencyKey } from "../../common/idempotency/require-idempotency-key.decorator";
import { EnvironmentBindingsService } from "./environment-bindings.service";
import { DeveloperAuthorizationService } from "./developer-authorization.service";

interface AuthenticatedRequest extends Request { user: { tenantId: string; userId: string; roles: string[] } }
const bindingSchema = z.object({
  environmentId: z.string().min(1), key: z.string().regex(/^[A-Za-z][A-Za-z0-9_.-]{0,119}$/),
  kind: z.enum(["SECRET", "SERVICE", "CONNECTOR", "CERTIFICATE"]),
  reference: z.string().min(10).max(2000), requiredCapabilities: z.array(z.string().min(1).max(160)).default([]),
});

@ApiTags("developer-platform-environment-bindings")
@ApiBearerAuth()
@Controller("dev/projects/:projectId/environment-bindings")
@UseGuards(JwtAuthGuard, RbacGuard)
export class EnvironmentBindingsController {
  constructor(private readonly bindings: EnvironmentBindingsService, private readonly authorization: DeveloperAuthorizationService) {}
  @Get() @Permissions("builder.read")
  async list(@Req() req: AuthenticatedRequest, @Param("projectId") projectId: string) { await this.authorization.assertProjectAction(req.user.tenantId, projectId, req.user, "AUTHOR"); return this.bindings.list(req.user.tenantId, projectId); }
  @Get("environment-options") @Permissions("builder.read")
  async environmentOptions(@Req() req: AuthenticatedRequest, @Param("projectId") projectId: string) { await this.authorization.assertProjectAction(req.user.tenantId, projectId, req.user, "AUTHOR"); return this.bindings.environmentOptions(req.user.tenantId, projectId); }
  @Post() @Permissions("builder.write") @RequireIdempotencyKey() @ApiOperation({ summary: "Create or update a non-secret environment binding reference" })
  async upsert(@Req() req: AuthenticatedRequest, @Param("projectId") projectId: string, @ZodBody(bindingSchema) body: z.infer<typeof bindingSchema>) { await this.authorization.assertProjectAction(req.user.tenantId, projectId, req.user, "AUTHOR"); return this.bindings.upsert({ ...body, tenantId: req.user.tenantId, projectId, createdBy: req.user.userId }); }
  @Post(":environmentId/:key/verify") @Permissions("builder.manage") @RequireIdempotencyKey()
  async verify(@Req() req: AuthenticatedRequest, @Param("projectId") projectId: string, @Param("environmentId") environmentId: string, @Param("key") key: string) { await this.authorization.assertProjectAction(req.user.tenantId, projectId, req.user, "RELEASE"); return this.bindings.verify({ tenantId: req.user.tenantId, projectId, environmentId, key }); }
  @Delete(":environmentId/:key") @Permissions("builder.write") @RequireIdempotencyKey()
  async remove(@Req() req: AuthenticatedRequest, @Param("projectId") projectId: string, @Param("environmentId") environmentId: string, @Param("key") key: string) { await this.authorization.assertProjectAction(req.user.tenantId, projectId, req.user, "AUTHOR"); return this.bindings.remove(req.user.tenantId, projectId, environmentId, key); }
}
