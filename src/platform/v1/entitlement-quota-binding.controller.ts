/**
 * M29 — C13 entitlements to M07 quota binding, console-facing surface.
 */
import { Controller, Get, Post, Param, UseGuards } from "@nestjs/common";
import { ApiTags, ApiOperation, ApiBearerAuth } from "@nestjs/swagger";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RbacGuard } from "../../common/guards/rbac.guard";
import { ControlPlaneGuard } from "../../common/guards/control-plane.guard";
import { Permissions } from "../../common/decorators/permissions.decorator";
import { SkipTenantScope } from "../../common/decorators/skip-tenant-scope.decorator";
import { EntitlementQuotaBindingService } from "./entitlement-quota-binding.service";

@ApiTags("platform")
@ApiBearerAuth()
@Controller("platform/v1/entitlement-quota")
@UseGuards(JwtAuthGuard, RbacGuard, ControlPlaneGuard)
@SkipTenantScope()
export class EntitlementQuotaBindingController {
  constructor(private readonly binding: EntitlementQuotaBindingService) {}

  @ApiOperation({ summary: "Sync a tenant's resource quota from its current plan entitlements (C13)" })
  @Post(":tenantId/sync")
  @Permissions("system.entitlementquota.sync")
  async sync(@Param("tenantId") tenantId: string) {
    return this.binding.syncQuotaFromEntitlements(tenantId);
  }

  @ApiOperation({ summary: "Get a tenant's current resource quota" })
  @Get(":tenantId")
  @Permissions("system.entitlementquota.read")
  async getCurrentQuota(@Param("tenantId") tenantId: string) {
    return this.binding.getCurrentQuota(tenantId);
  }
}
