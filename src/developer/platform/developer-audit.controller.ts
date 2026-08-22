import { Controller, Get, Param, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import { Permissions } from "../../common/decorators/permissions.decorator";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RbacGuard } from "../../common/guards/rbac.guard";
import { DeveloperAuthorizationService } from "./developer-authorization.service";
import { DeveloperAuditService } from "./developer-audit.service";
interface AuthenticatedRequest extends Request { user: { tenantId: string; userId: string; roles: string[] } }
@ApiTags("developer-platform-audit") @ApiBearerAuth() @Controller("dev/projects") @UseGuards(JwtAuthGuard, RbacGuard)
export class DeveloperAuditController { constructor(private readonly audit: DeveloperAuditService, private readonly authorization: DeveloperAuthorizationService) {} @Get(":projectId/audit-events") @Permissions("builder.read") async list(@Req() req: AuthenticatedRequest, @Param("projectId") projectId: string) { await this.authorization.assertProjectAction(req.user.tenantId, projectId, req.user, "AUTHOR"); return this.audit.list(req.user.tenantId, projectId); } }
