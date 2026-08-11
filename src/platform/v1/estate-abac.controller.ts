/**
 * M33 — estate ABAC grants, console-facing surface, and a
 * ping-authorization endpoint proving the guard-independent check
 * available for other controllers to compose via `@RequireEstateGrant()`.
 */
import { Controller, Get, Post, Body, Param, UseGuards } from "@nestjs/common";
import { ApiTags, ApiOperation, ApiBearerAuth } from "@nestjs/swagger";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RbacGuard } from "../../common/guards/rbac.guard";
import { ControlPlaneGuard } from "../../common/guards/control-plane.guard";
import { EstateAbacGuard } from "../../common/guards/estate-abac.guard";
import { RequireEstateGrant } from "../../common/decorators/estate-abac.decorator";
import { Permissions } from "../../common/decorators/permissions.decorator";
import { SkipTenantScope } from "../../common/decorators/skip-tenant-scope.decorator";
import { EstateAbacService, type EstateCapability, type EstateGrantScope } from "./estate-abac.service";

@ApiTags("platform")
@ApiBearerAuth()
@Controller("platform/v1/estate-grants")
@UseGuards(JwtAuthGuard, RbacGuard, ControlPlaneGuard, EstateAbacGuard)
@SkipTenantScope()
export class EstateAbacController {
  constructor(private readonly abac: EstateAbacService) {}

  @ApiOperation({ summary: "Create an attribute-scoped estate grant" })
  @Post()
  @Permissions("system.estategrant.manage")
  async grant(@Body() body: { subjectId: string; capability: EstateCapability; scope: EstateGrantScope }) {
    return this.abac.grant(body.subjectId, body.capability, body.scope);
  }

  @ApiOperation({ summary: "Check whether an estate grant authorises a plan against this resource -- 403 if not" })
  @Get(":id/authorize-plan")
  @Permissions("system.estategrant.read")
  @RequireEstateGrant({ capability: "plan" })
  async authorizePlan(@Param("id") id: string) {
    return { authorized: true, resourceId: id };
  }
}
