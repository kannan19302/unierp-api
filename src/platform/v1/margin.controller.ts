/**
 * M28 — margin, console-facing surface. K19 (launch readiness) reads
 * this endpoint.
 */
import { Controller, Get, Param, UseGuards } from "@nestjs/common";
import { ApiTags, ApiOperation, ApiBearerAuth } from "@nestjs/swagger";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RbacGuard } from "../../common/guards/rbac.guard";
import { ControlPlaneGuard } from "../../common/guards/control-plane.guard";
import { Permissions } from "../../common/decorators/permissions.decorator";
import { SkipTenantScope } from "../../common/decorators/skip-tenant-scope.decorator";
import { MarginService } from "./margin.service";

@ApiTags("platform")
@ApiBearerAuth()
@Controller("platform/v1/margin")
@UseGuards(JwtAuthGuard, RbacGuard, ControlPlaneGuard)
@SkipTenantScope()
export class MarginController {
  constructor(private readonly margin: MarginService) {}

  @ApiOperation({ summary: "Gross margin for a tenant/period, with cost traceable to M25's ingested lines and revenue to C16's invoices" })
  @Get(":tenantId/:period")
  @Permissions("system.margin.read")
  async getTenantMargin(@Param("tenantId") tenantId: string, @Param("period") period: string) {
    return this.margin.getTenantMargin(tenantId, period);
  }
}
