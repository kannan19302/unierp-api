import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards, Req } from "@nestjs/common";
import { ApiTags, ApiOperation, ApiBearerAuth } from "@nestjs/swagger";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RbacGuard } from "../../common/guards/rbac.guard";
import { ControlPlaneGuard } from '../../common/guards/control-plane.guard';
import { Permissions } from "../../common/decorators/permissions.decorator";
import { SkipTenantScope } from '../../common/decorators/skip-tenant-scope.decorator';
import { SaasClusterRoutingDeepService, RateLimitRuleDto, WafRuleDto } from "./cluster-routing.service";

@ApiTags("SaasClusterRoutingDeep")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RbacGuard, ControlPlaneGuard)
@Controller("platform/v1/cluster-routing-deep")
@SkipTenantScope()
export class SaasClusterRoutingDeepController {
  constructor(private readonly routingService: SaasClusterRoutingDeepService) {}

  @ApiOperation({ summary: "Get multi-tenant clusters" })
  @Permissions("system.clusters.read")
  @Get("clusters")
  async getClusters() {
    return this.routingService.getClusters();
  }

  @ApiOperation({ summary: "Create multi-tenant cluster" })
  @Permissions("system.clusters.create")
  @Post("clusters")
  async createCluster(@Body() dto: any) {
    return this.routingService.createCluster(dto);
  }

  @ApiOperation({ summary: "Get tenant node routing" })
  @Permissions("system.clusters.read")
  @Get("routing")
  async getTenantRouting(@Req() req: any) {
    return this.routingService.getTenantRouting(req.user.tenantId);
  }

  @ApiOperation({ summary: "Set tenant node routing" })
  @Permissions("system.clusters.update")
  @Post("routing")
  async setTenantRouting(@Req() req: any, @Body() dto: any) {
    return this.routingService.setTenantRouting(req.user.tenantId, dto);
  }

  // --- Rate Limit Rules (PCC-08) ---

  @ApiOperation({ summary: "Get rate limit rules" })
  @Permissions("system.clusters.read")
  @Get("rate-limits")
  async getRateLimitRules() {
    return this.routingService.getRateLimitRules();
  }

  @ApiOperation({ summary: "Create rate limit rule" })
  @Permissions("system.clusters.create")
  @Post("rate-limits")
  async createRateLimitRule(@Body() dto: RateLimitRuleDto) {
    return this.routingService.createRateLimitRule(dto);
  }

  @ApiOperation({ summary: "Update rate limit rule" })
  @Permissions("system.clusters.update")
  @Put("rate-limits/:id")
  async updateRateLimitRule(@Param("id") id: string, @Body() dto: Partial<RateLimitRuleDto>) {
    return this.routingService.updateRateLimitRule(id, dto);
  }

  @ApiOperation({ summary: "Delete rate limit rule" })
  @Permissions("system.clusters.update")
  @Delete("rate-limits/:id")
  async deleteRateLimitRule(@Param("id") id: string) {
    return this.routingService.deleteRateLimitRule(id);
  }

  // --- API Deprecation Timeline (PCC-08) ---

  @ApiOperation({ summary: "Get API deprecation timeline" })
  @Permissions("system.clusters.read")
  @Get("deprecations")
  async getDeprecations() {
    return this.routingService.getDeprecations();
  }

  @ApiOperation({ summary: "Dispatch sunset notification to deprecated API consumers" })
  @Permissions("system.clusters.update")
  @Post("deprecations/:id/notify")
  async notifySunset(@Param("id") id: string) {
    return this.routingService.notifySunset(id);
  }

  // --- Traffic Stats & WAF (PCC-08) ---

  @ApiOperation({ summary: "Get gateway traffic statistics" })
  @Permissions("system.clusters.read")
  @Get("traffic-stats")
  async getTrafficStats() {
    return this.routingService.getTrafficStats();
  }

  @ApiOperation({ summary: "Get WAF security rules" })
  @Permissions("system.clusters.read")
  @Get("waf-rules")
  async getWafRules() {
    return this.routingService.getWafRules();
  }

  @ApiOperation({ summary: "Deploy WAF security rule" })
  @Permissions("system.clusters.create")
  @Post("waf-rules")
  async createWafRule(@Body() dto: WafRuleDto) {
    return this.routingService.createWafRule(dto);
  }
}
