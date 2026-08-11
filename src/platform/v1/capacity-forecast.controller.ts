/**
 * M24 — capacity forecasting surface. Extends C05's operations dashboard
 * (a new read this controller adds) rather than replacing anything C05
 * already serves.
 */
import { Controller, Get, Post, Param, Query, Body, UseGuards } from "@nestjs/common";
import { ApiTags, ApiOperation, ApiBearerAuth } from "@nestjs/swagger";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RbacGuard } from "../../common/guards/rbac.guard";
import { ControlPlaneGuard } from "../../common/guards/control-plane.guard";
import { Permissions } from "../../common/decorators/permissions.decorator";
import { SkipTenantScope } from "../../common/decorators/skip-tenant-scope.decorator";
import { CapacityForecastService } from "./capacity-forecast.service";

@ApiTags("platform")
@ApiBearerAuth()
@Controller("platform/v1/capacity")
@UseGuards(JwtAuthGuard, RbacGuard, ControlPlaneGuard)
@SkipTenantScope()
export class CapacityForecastController {
  constructor(private readonly capacity: CapacityForecastService) {}

  @ApiOperation({ summary: "Forecast a resource's capacity trend and predicted shortfall date" })
  @Get(":resourceId/:metric")
  @Permissions("system.capacity.read")
  async forecast(@Param("resourceId") resourceId: string, @Param("metric") metric: string) {
    return this.capacity.forecast(resourceId, metric);
  }

  @ApiOperation({ summary: "Record a capacity observation" })
  @Post(":resourceId/:metric/observations")
  @Permissions("system.capacity.scale")
  async recordObservation(
    @Param("resourceId") resourceId: string,
    @Param("metric") metric: string,
    @Body() body: { value: number; capacity: number; observedAt: string },
  ) {
    return this.capacity.recordObservation(resourceId, metric, body.value, body.capacity, new Date(body.observedAt));
  }

  @ApiOperation({ summary: "Check for a predicted shortfall within the lookahead window and alert if found" })
  @Get(":resourceId/:metric/check")
  @Permissions("system.capacity.read")
  async checkAndAlert(@Param("resourceId") resourceId: string, @Param("metric") metric: string, @Query("lookaheadDays") lookaheadDays?: string) {
    return this.capacity.checkAndAlert(resourceId, metric, lookaheadDays ? Number(lookaheadDays) : undefined);
  }

  @ApiOperation({ summary: "Propose and execute a scaling plan on the pipeline" })
  @Post(":resourceId/scale")
  @Permissions("system.capacity.scale")
  async proposeScalingPlan(@Param("resourceId") resourceId: string, @Body() body: { newCapacity: number }) {
    return this.capacity.proposeScalingPlan(resourceId, body.newCapacity);
  }
}
