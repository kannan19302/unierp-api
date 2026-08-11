/**
 * M19 — the console's Kubernetes surface, made operable. Reuses the
 * existing `system.clusters.*` permissions SaasClusterRoutingDeepController
 * already carries, since this is the same domain gaining a real mutation
 * path rather than a new one.
 */
import { Controller, Get, Post, Param, Query, Body, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { ApiTags, ApiOperation, ApiBearerAuth } from "@nestjs/swagger";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RbacGuard } from "../../common/guards/rbac.guard";
import { ControlPlaneGuard } from "../../common/guards/control-plane.guard";
import { Permissions } from "../../common/decorators/permissions.decorator";
import { SkipTenantScope } from "../../common/decorators/skip-tenant-scope.decorator";
import { KubernetesFleetService } from "./kubernetes-fleet.service";

interface ProposeBody {
  tenantId: string;
  clusterId: string;
  weight: number;
}

interface ApplyBody {
  approvalId: string;
  resourceId: string;
  tenantId: string;
  clusterId: string;
  weight: number;
}

@ApiTags("platform")
@ApiBearerAuth()
@Controller("platform/v1/kubernetes")
@UseGuards(JwtAuthGuard, RbacGuard, ControlPlaneGuard)
@SkipTenantScope()
export class KubernetesFleetController {
  constructor(private readonly fleet: KubernetesFleetService) {}

  @ApiOperation({ summary: "List routing weights, optionally filtered by cluster" })
  @Get("routing")
  @Permissions("system.clusters.read")
  async listRouting(@Query("clusterId") clusterId?: string) {
    return this.fleet.listRoutingWeights(clusterId);
  }

  @ApiOperation({ summary: "Get one routing row plus its desired-state version history" })
  @Get("routing/:id")
  @Permissions("system.clusters.read")
  async getRouting(@Param("id") id: string) {
    return this.fleet.getRoutingById(id);
  }

  @ApiOperation({ summary: "Propose a routing-weight change: compiles a plan and requests approval" })
  @Post("routing/propose")
  @Permissions("system.clusters.update")
  async propose(@Body() body: ProposeBody, @Req() req: Request & { user?: { userId?: string } }) {
    return this.fleet.proposeRoutingWeight(body.tenantId, body.clusterId, body.weight, req.user?.userId ?? "unknown");
  }

  @ApiOperation({ summary: "Decide the approval and apply the routing-weight change as a durable, reconciled job" })
  @Post("routing/apply")
  @Permissions("system.clusters.update")
  async apply(@Body() body: ApplyBody, @Req() req: Request & { user?: { userId?: string } }) {
    return this.fleet.applyRoutingWeight(
      body.approvalId,
      body.resourceId,
      body.tenantId,
      body.clusterId,
      body.weight,
      req.user?.userId ?? "unknown",
    );
  }

  @ApiOperation({ summary: "Compile a rollback plan for a routing-weight resource to a prior version" })
  @Post("routing/:resourceId/rollback")
  @Permissions("system.clusters.update")
  async rollback(@Param("resourceId") resourceId: string, @Body() body: { targetVersion: number }, @Req() req: Request & { user?: { userId?: string } }) {
    return this.fleet.rollbackRoutingWeight(resourceId, body.targetVersion, req.user?.userId ?? "unknown");
  }
}
