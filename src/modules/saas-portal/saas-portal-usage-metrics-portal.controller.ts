import { Controller, Get, UseGuards, Req } from "@nestjs/common";
import { ApiTags, ApiOperation, ApiBearerAuth } from "@nestjs/swagger";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RbacGuard } from "../../common/guards/rbac.guard";
import { Permissions } from "../../common/decorators/permissions.decorator";
import { SaasPortalUsageMetricsPortalService } from "./saas-portal-usage-metrics-portal.service";

/**
 * D21 — the POST "update dashboard snapshot" route that used to exist
 * here is gone: it wrote to a second, disconnected usage dataset a
 * tenant's view could diverge from what their invoice was actually
 * computed from. Usage now flows one way — into the real UsageRecord
 * table, by the platform's own metering pipeline, never by this portal
 * route — so there is no second path to accidentally diverge from.
 */
@ApiTags("SaasPortalUsageMetricsPortal")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RbacGuard)
@Controller("saas-portal/usage-metrics")
export class SaasPortalUsageMetricsPortalController {
  constructor(
    private readonly usageService: SaasPortalUsageMetricsPortalService,
  ) {}

  @ApiOperation({ summary: "Get portal tenant usage dashboard — reconciles exactly with the invoice-computing UsageRecord table" })
  @Permissions("saas_portal.usage.read")
  @Get("dashboard")
  async getUsageDashboard(@Req() req: any) {
    return this.usageService.getUsageDashboard(req.user.tenantId);
  }
}
