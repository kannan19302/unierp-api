/**
 * M32 — just-in-time privilege elevation, console-facing surface.
 */
import { Controller, Get, Post, Query, Body, UseGuards } from "@nestjs/common";
import { ApiTags, ApiOperation, ApiBearerAuth } from "@nestjs/swagger";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RbacGuard } from "../../common/guards/rbac.guard";
import { ControlPlaneGuard } from "../../common/guards/control-plane.guard";
import { Permissions } from "../../common/decorators/permissions.decorator";
import { SkipTenantScope } from "../../common/decorators/skip-tenant-scope.decorator";
import { PrivilegeElevationService } from "./privilege-elevation.service";

@ApiTags("platform")
@ApiBearerAuth()
@Controller("platform/v1/privilege-elevation")
@UseGuards(JwtAuthGuard, RbacGuard, ControlPlaneGuard)
@SkipTenantScope()
export class PrivilegeElevationController {
  constructor(private readonly elevation: PrivilegeElevationService) {}

  @ApiOperation({ summary: "Grant a just-in-time privilege elevation with a hard expiry" })
  @Post()
  @Permissions("system.privilegeelevation.grant")
  async grant(@Body() body: { userId: string; privilege: string; grantedBy: string; ttlMs: number }) {
    return this.elevation.grant(body.userId, body.privilege, body.grantedBy, body.ttlMs);
  }

  @ApiOperation({ summary: "Check whether a user currently holds an elevated privilege — expires automatically" })
  @Get()
  @Permissions("system.privilegeelevation.read")
  async isElevated(@Query("userId") userId: string, @Query("privilege") privilege: string) {
    return { elevated: await this.elevation.isElevated(userId, privilege) };
  }
}
