import { Controller, Get, Param, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import { Permissions } from "../../common/decorators/permissions.decorator";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RbacGuard } from "../../common/guards/rbac.guard";
import { DeveloperAuthorizationService } from "./developer-authorization.service";
import { ProjectSourceExportService } from "./project-source-export.service";
interface AuthenticatedRequest extends Request { user: { tenantId: string; userId: string; roles: string[] } }
@ApiTags("developer-platform-source") @ApiBearerAuth() @Controller("dev/projects") @UseGuards(JwtAuthGuard, RbacGuard)
export class ProjectSourceExportController {
  constructor(private readonly source: ProjectSourceExportService, private readonly authorization: DeveloperAuthorizationService) {}
  @Get(":projectId/source-export") @Permissions("builder.read") @ApiOperation({ summary: "Export canonical project IR for IDE and Git integrations" })
  async export(@Req() req: AuthenticatedRequest, @Param("projectId") projectId: string) {
    await this.authorization.assertProjectAction(req.user.tenantId, projectId, req.user, "AUTHOR");
    return this.source.export(req.user.tenantId, projectId);
  }
}
