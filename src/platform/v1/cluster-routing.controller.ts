import { Controller, Get, Post, Body, UseGuards, Req } from "@nestjs/common";
import { ApiTags, ApiOperation, ApiBearerAuth } from "@nestjs/swagger";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RbacGuard } from "../../common/guards/rbac.guard";
import { ControlPlaneGuard } from '../../common/guards/control-plane.guard';
import { Permissions } from "../../common/decorators/permissions.decorator";
import { SkipTenantScope } from '../../common/decorators/skip-tenant-scope.decorator';
import { SaasClusterRoutingDeepService } from "./cluster-routing.service";

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
}
