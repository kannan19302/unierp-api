import { Controller, Get, Post, Delete, Body, Param, Query, UseGuards } from "@nestjs/common";
import { ApiTags, ApiOperation, ApiBearerAuth } from "@nestjs/swagger";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RbacGuard } from "../../common/guards/rbac.guard";
import { ControlPlaneGuard } from "../../common/guards/control-plane.guard";
import { SkipTenantScope } from "../../common/decorators/skip-tenant-scope.decorator";
import { Permissions } from "../../common/decorators/permissions.decorator";
import {
  PlatformDeveloperEcosystemService,
  RegisterAppDto,
  CreateSandboxDto,
  PublishSdkDto,
} from "./developer-ecosystem.service";

@ApiTags("Platform Developer Ecosystem (PCC-14)")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RbacGuard, ControlPlaneGuard)
@Controller("platform/v1/developer-ecosystem")
@SkipTenantScope()
export class PlatformDeveloperEcosystemController {
  constructor(private readonly devService: PlatformDeveloperEcosystemService) {}

  // --- 1. Developer App Registration (EC-14.1) ---

  @ApiOperation({ summary: "List registered developer applications" })
  @Permissions("system.developer.read")
  @Get("apps")
  async getApps(
    @Query("search") search?: string,
    @Query("status") status?: string
  ) {
    return this.devService.getApps(search, status);
  }

  @ApiOperation({ summary: "Register new developer OAuth app with client ID & secret" })
  @Permissions("system.developer.write")
  @Post("apps")
  async registerApp(@Body() dto: RegisterAppDto) {
    return this.devService.registerApp(dto);
  }

  @ApiOperation({ summary: "Rotate client secret for a developer app" })
  @Permissions("system.developer.write")
  @Post("apps/:id/rotate-secret")
  async rotateSecret(@Param("id") id: string) {
    return this.devService.rotateSecret(id);
  }

  @ApiOperation({ summary: "Revoke and delete a developer application" })
  @Permissions("system.developer.write")
  @Delete("apps/:id")
  async deleteApp(@Param("id") id: string) {
    return this.devService.deleteApp(id);
  }

  // --- 2. Sandbox Environments (EC-14.2) ---

  @ApiOperation({ summary: "List active developer sandboxes" })
  @Permissions("system.developer.read")
  @Get("sandboxes")
  async getSandboxes() {
    return this.devService.getSandboxes();
  }

  @ApiOperation({ summary: "Provision new isolated sandbox environment" })
  @Permissions("system.developer.write")
  @Post("sandboxes")
  async createSandbox(@Body() dto: CreateSandboxDto) {
    return this.devService.createSandbox(dto);
  }

  @ApiOperation({ summary: "Extend sandbox expiration period" })
  @Permissions("system.developer.write")
  @Post("sandboxes/:id/extend")
  async extendSandbox(
    @Param("id") id: string,
    @Body() body: { days?: number }
  ) {
    return this.devService.extendSandbox(id, body?.days || 14);
  }

  @ApiOperation({ summary: "Destroy and de-provision a sandbox environment" })
  @Permissions("system.developer.write")
  @Delete("sandboxes/:id")
  async destroySandbox(@Param("id") id: string) {
    return this.devService.destroySandbox(id);
  }

  // --- 3. SDK Releases & Distribution (EC-14.3) ---

  @ApiOperation({ summary: "List SDK packages and distribution channels" })
  @Permissions("system.developer.read")
  @Get("sdks")
  async getSdks() {
    return this.devService.getSdks();
  }

  @ApiOperation({ summary: "Publish new SDK package release" })
  @Permissions("system.developer.write")
  @Post("sdks")
  async publishSdk(@Body() dto: PublishSdkDto) {
    return this.devService.publishSdkRelease(dto);
  }

  @ApiOperation({ summary: "Deprecate SDK release with scheduled sunset" })
  @Permissions("system.developer.write")
  @Post("sdks/:id/deprecate")
  async deprecateSdk(
    @Param("id") id: string,
    @Body() body: { sunsetDays?: number }
  ) {
    return this.devService.deprecateSdk(id, body?.sunsetDays || 90);
  }
}
