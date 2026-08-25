import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  UseGuards,
} from "@nestjs/common";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RbacGuard } from "../../common/guards/rbac.guard";
import { ControlPlaneGuard } from "../../common/guards/control-plane.guard";
import { SkipTenantScope } from "../../common/decorators/skip-tenant-scope.decorator";
import { Permissions } from "../../common/decorators/permissions.decorator";
import { ApiTags, ApiOperation, ApiBearerAuth } from "@nestjs/swagger";
import {
  DesktopOperationsService,
  type DesktopUpdatePolicy,
} from "./desktop-operations.service";

@ApiTags("platform")
@ApiBearerAuth()
@Controller("platform/v1/desktop-operations")
@UseGuards(JwtAuthGuard, RbacGuard, ControlPlaneGuard)
@SkipTenantScope()
export class DesktopOperationsController {
  constructor(private readonly desktopOps: DesktopOperationsService) {}

  @ApiOperation({ summary: "Get desktop platform operations dashboard summary" })
  @Get("dashboard")
  @Permissions("system.desktop.read")
  async getDashboard() {
    return this.desktopOps.getDashboard();
  }

  @ApiOperation({ summary: "List desktop installer builds across OS targets" })
  @Get("builds")
  @Permissions("system.desktop.read")
  async listBuilds() {
    return this.desktopOps.listBuilds();
  }

  @ApiOperation({ summary: "Register new desktop build artifact" })
  @Post("builds")
  @Permissions("system.desktop.deploy")
  async registerBuild(
    @Body()
    body: {
      targetOs: "windows-x64" | "windows-arm64" | "macos-arm64" | "macos-x64" | "linux-x64";
      version: string;
      installerType: "exe" | "msi" | "dmg" | "pkg" | "deb" | "AppImage";
      commitHash: string;
      sha256: string;
      fileSizeBytes?: number;
      downloadUrl?: string;
    },
  ) {
    return this.desktopOps.registerBuild(body);
  }

  @ApiOperation({ summary: "List desktop release channels (stable, beta, nightly)" })
  @Get("channels")
  @Permissions("system.desktop.read")
  async listChannels() {
    return this.desktopOps.listChannels();
  }

  @ApiOperation({ summary: "Promote build to a desktop release channel with staged rollout" })
  @Post("channels/promote")
  @Permissions("system.desktop.deploy")
  async promoteChannel(
    @Body()
    body: {
      channel: "stable" | "beta" | "nightly";
      version: string;
      rolloutPercentage?: number;
    },
  ) {
    return this.desktopOps.promoteChannel(body);
  }

  @ApiOperation({ summary: "Get desktop auto-updater and minimum version policy" })
  @Get("update-policy")
  @Permissions("system.desktop.read")
  async getUpdatePolicy() {
    return this.desktopOps.getUpdatePolicy();
  }

  @ApiOperation({ summary: "Update desktop update policy or emergency killswitch" })
  @Put("update-policy")
  @Permissions("system.desktop.manage")
  async updateUpdatePolicy(@Body() body: Partial<DesktopUpdatePolicy>) {
    return this.desktopOps.updateUpdatePolicy(body);
  }

  @ApiOperation({ summary: "List code signing certificate and notarization profiles" })
  @Get("signing-profiles")
  @Permissions("system.desktop.read")
  async getSigningProfiles() {
    return this.desktopOps.getSigningProfiles();
  }
}
