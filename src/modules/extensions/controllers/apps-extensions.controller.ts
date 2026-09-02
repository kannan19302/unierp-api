import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  UseGuards,
  Req,
} from "@nestjs/common";
import { Request } from "express";
import { JwtAuthGuard } from "../../../common/guards/jwt-auth.guard";
import { RbacGuard } from "../../../common/guards/rbac.guard";
import { Permissions } from "../../../common/decorators/permissions.decorator";
import { ApiTags, ApiOperation, ApiBearerAuth } from "@nestjs/swagger";
import { AppsExtensionsService } from "../services/apps-extensions.service";

interface AuthenticatedRequest extends Request {
  user: { tenantId: string; userId: string; email: string; roles: string[] };
}

@ApiTags("tenant-admin")
@ApiBearerAuth()
@Controller("api/v1/apps-extensions")
@UseGuards(JwtAuthGuard, RbacGuard)
export class AppsExtensionsController {
  constructor(private readonly appsExtensions: AppsExtensionsService) {}

  @ApiOperation({ summary: "Get apps & extensions overview and recommendations" })
  @Get("dashboard")
  @Permissions("occ.extensions.access", "admin.users.read")
  async getDashboard(@Req() req: AuthenticatedRequest) {
    const tenantId = req.user?.tenantId || "default-tenant";
    return this.appsExtensions.getDashboard(tenantId);
  }

  @ApiOperation({ summary: "List installed extensions and applications" })
  @Get("installed")
  @Permissions("occ.extensions.access", "admin.users.read")
  async listInstalled(@Req() req: AuthenticatedRequest) {
    const tenantId = req.user?.tenantId || "default-tenant";
    return this.appsExtensions.listInstalled(tenantId);
  }

  @ApiOperation({ summary: "List certified marketplace catalog" })
  @Get("catalog")
  @Permissions("occ.extensions.access", "admin.users.read")
  async listCatalog(@Req() req: AuthenticatedRequest) {
    const tenantId = req.user?.tenantId || "default-tenant";
    return this.appsExtensions.listCatalog(tenantId);
  }

  @ApiOperation({ summary: "Install marketplace extension with scope consent" })
  @Post("install")
  @Permissions("occ.extensions.access", "admin.users.manage")
  async installExtension(
    @Req() req: AuthenticatedRequest,
    @Body()
    body: {
      extensionKey: string;
      updateChannel?: "stable" | "beta";
      autoUpdate?: boolean;
      configValues?: Record<string, unknown>;
    },
  ) {
    const tenantId = req.user?.tenantId || "default-tenant";
    return this.appsExtensions.installExtension(tenantId, body);
  }

  @ApiOperation({ summary: "Toggle extension active state (enable/pause)" })
  @Post(":id/toggle")
  @Permissions("occ.extensions.access", "admin.users.manage")
  async toggleExtension(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() body: { enabled: boolean },
  ) {
    const tenantId = req.user?.tenantId || "default-tenant";
    return this.appsExtensions.toggleExtension(tenantId, id, body.enabled);
  }

  @ApiOperation({ summary: "Upgrade extension to latest version" })
  @Post(":id/upgrade")
  @Permissions("occ.extensions.access", "admin.users.manage")
  async updateExtension(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
  ) {
    const tenantId = req.user?.tenantId || "default-tenant";
    return this.appsExtensions.updateExtension(tenantId, id);
  }

  @ApiOperation({ summary: "Update extension configuration values" })
  @Put(":id/config")
  @Permissions("occ.extensions.access", "admin.users.manage")
  async configureExtension(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() body: { config: Record<string, unknown> },
  ) {
    const tenantId = req.user?.tenantId || "default-tenant";
    return this.appsExtensions.configureExtension(tenantId, id, body.config);
  }

  @ApiOperation({ summary: "Uninstall extension and revoke permissions" })
  @Delete(":id")
  @Permissions("occ.extensions.access", "admin.users.manage")
  async uninstallExtension(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
  ) {
    const tenantId = req.user?.tenantId || "default-tenant";
    return this.appsExtensions.uninstallExtension(tenantId, id);
  }
}
