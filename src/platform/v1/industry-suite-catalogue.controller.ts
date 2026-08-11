/**
 * M44 — HTTP surface for the catalogue mechanism proven in
 * industry-suite-catalogue.service.ts.
 */
import { Controller, Get, Post, Param, Body, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RbacGuard } from "../../common/guards/rbac.guard";
import { ControlPlaneGuard } from "../../common/guards/control-plane.guard";
import { StepUpMfaGuard } from "../../common/guards/step-up-mfa.guard";
import { SkipTenantScope } from "../../common/decorators/skip-tenant-scope.decorator";
import { Permissions } from "../../common/decorators/permissions.decorator";
import { ApiTags, ApiOperation, ApiBearerAuth } from "@nestjs/swagger";
import { IndustrySuiteCatalogueService } from "./industry-suite-catalogue.service";

interface ProvisionBody {
  tenantId: string;
}

@ApiTags("platform")
@ApiBearerAuth()
@Controller("platform/v1/catalogue")
@UseGuards(JwtAuthGuard, RbacGuard, ControlPlaneGuard, StepUpMfaGuard)
@SkipTenantScope()
export class IndustrySuiteCatalogueController {
  constructor(private readonly catalogue: IndustrySuiteCatalogueService) {}

  @ApiOperation({ summary: "Compose and price a suite from its catalogue products" })
  @Get("suites/:suiteId/compose")
  @Permissions("system.catalogue.read")
  async compose(@Param("suiteId") suiteId: string) {
    return this.catalogue.composeSuite(suiteId);
  }

  @ApiOperation({ summary: "Provision a suite for a tenant from the catalogue" })
  @Post("suites/:suiteId/provision")
  @Permissions("system.catalogue.manage")
  async provision(@Param("suiteId") suiteId: string, @Body() body: ProvisionBody) {
    return this.catalogue.provisionSuite(suiteId, body.tenantId);
  }
}
