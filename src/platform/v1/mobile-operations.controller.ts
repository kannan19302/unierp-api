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
  MobileOperationsService,
  type MobileVersionPolicy,
} from "./mobile-operations.service";

@ApiTags("platform")
@ApiBearerAuth()
@Controller("platform/v1/mobile-operations")
@UseGuards(JwtAuthGuard, RbacGuard, ControlPlaneGuard)
@SkipTenantScope()
export class MobileOperationsController {
  constructor(private readonly mobileOps: MobileOperationsService) {}

  @ApiOperation({ summary: "Get mobile platform operations dashboard summary" })
  @Get("dashboard")
  @Permissions("system.mobile.read")
  async getDashboard() {
    return this.mobileOps.getDashboard();
  }

  @ApiOperation({ summary: "List mobile builds for iOS and Android" })
  @Get("builds")
  @Permissions("system.mobile.read")
  async listBuilds() {
    return this.mobileOps.listBuilds();
  }

  @ApiOperation({ summary: "Register new mobile build artifact" })
  @Post("builds")
  @Permissions("system.mobile.deploy")
  async registerBuild(
    @Body()
    body: {
      platform: "ios" | "android";
      version: string;
      buildNumber: number;
      commitHash: string;
      branch?: string;
      artifactSizeMb?: number;
      storeUrl?: string;
    },
  ) {
    return this.mobileOps.registerBuild(body);
  }

  @ApiOperation({ summary: "List release channels (production, beta, alpha)" })
  @Get("channels")
  @Permissions("system.mobile.read")
  async listChannels() {
    return this.mobileOps.listChannels();
  }

  @ApiOperation({ summary: "Promote build to a release channel with phased rollout" })
  @Post("channels/promote")
  @Permissions("system.mobile.deploy")
  async promoteChannel(
    @Body()
    body: {
      channel: "alpha" | "beta" | "production";
      version: string;
      buildNumber: number;
      rolloutPercentage?: number;
    },
  ) {
    return this.mobileOps.promoteChannel(body);
  }

  @ApiOperation({ summary: "Get mobile version and minimum compatibility policy" })
  @Get("version-policy")
  @Permissions("system.mobile.read")
  async getVersionPolicy() {
    return this.mobileOps.getVersionPolicy();
  }

  @ApiOperation({ summary: "Update mobile version policy or activate killswitch" })
  @Put("version-policy")
  @Permissions("system.mobile.manage")
  async updateVersionPolicy(@Body() body: Partial<MobileVersionPolicy>) {
    return this.mobileOps.updateVersionPolicy(body);
  }

  @ApiOperation({ summary: "List push notification provider bindings (APNs, FCM)" })
  @Get("push-providers")
  @Permissions("system.mobile.read")
  async listPushProviders() {
    return this.mobileOps.listPushProviders();
  }

  @ApiOperation({ summary: "Send diagnostic push notification test" })
  @Post("push-providers/test")
  @Permissions("system.mobile.manage")
  async testPushNotification(
    @Body() body: { provider: "FCM" | "APNs"; deviceToken?: string },
  ) {
    return this.mobileOps.testPushNotification(body);
  }
}
