/**
 * M32 — multi-provider staff IdP, console-facing surface.
 */
import { Controller, Post, Body, UseGuards } from "@nestjs/common";
import { ApiTags, ApiOperation, ApiBearerAuth } from "@nestjs/swagger";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RbacGuard } from "../../common/guards/rbac.guard";
import { ControlPlaneGuard } from "../../common/guards/control-plane.guard";
import { Permissions } from "../../common/decorators/permissions.decorator";
import { SkipTenantScope } from "../../common/decorators/skip-tenant-scope.decorator";
import { StaffIdpService } from "./staff-idp.service";

@ApiTags("platform")
@ApiBearerAuth()
@Controller("platform/v1/staff-idp")
@UseGuards(JwtAuthGuard, RbacGuard, ControlPlaneGuard)
@SkipTenantScope()
export class StaffIdpController {
  constructor(private readonly idp: StaffIdpService) {}

  @ApiOperation({ summary: "Authenticate a staff operator through whichever registered IdP M06 routes to" })
  @Post("authenticate")
  @Permissions("system.staffidp.manage")
  async authenticate(@Body() body: { operatorId: string; nameId: string }) {
    return this.idp.authenticateStaff(body.operatorId, body.nameId);
  }
}
