/**
 * M26 — real-time utilisation, console-facing surface. Extends C05's
 * operations dashboard with a new read; replaces nothing C05 owns.
 */
import { Controller, Get, Post, Param, Query, Body, UseGuards } from "@nestjs/common";
import { ApiTags, ApiOperation, ApiBearerAuth } from "@nestjs/swagger";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RbacGuard } from "../../common/guards/rbac.guard";
import { ControlPlaneGuard } from "../../common/guards/control-plane.guard";
import { Permissions } from "../../common/decorators/permissions.decorator";
import { SkipTenantScope } from "../../common/decorators/skip-tenant-scope.decorator";
import { TelemetryService } from "./telemetry.service";

@ApiTags("platform")
@ApiBearerAuth()
@Controller("platform/v1/telemetry")
@UseGuards(JwtAuthGuard, RbacGuard, ControlPlaneGuard)
@SkipTenantScope()
export class TelemetryController {
  constructor(private readonly telemetry: TelemetryService) {}

  @ApiOperation({ summary: "Record a telemetry sample for a resource/metric" })
  @Post(":resourceId/:metric")
  @Permissions("system.telemetry.write")
  async record(@Param("resourceId") resourceId: string, @Param("metric") metric: string, @Body() body: { value: number; observedAt?: string }) {
    return this.telemetry.recordSample(resourceId, metric, body.value, body.observedAt ? new Date(body.observedAt) : undefined);
  }

  @ApiOperation({ summary: "Get current utilisation — FRESH/STALE/NO_DATA, never a gap silently shown as zero" })
  @Get(":resourceId/:metric")
  @Permissions("system.telemetry.read")
  async getUtilization(@Param("resourceId") resourceId: string, @Param("metric") metric: string) {
    return this.telemetry.getUtilization(resourceId, metric);
  }

  @ApiOperation({ summary: "Get a bucketed utilisation series over a time range — gaps reported as null, never interpolated" })
  @Get(":resourceId/:metric/series")
  @Permissions("system.telemetry.read")
  async getSeries(
    @Param("resourceId") resourceId: string,
    @Param("metric") metric: string,
    @Query("from") from: string,
    @Query("to") to: string,
    @Query("intervalMs") intervalMs: string,
  ) {
    return this.telemetry.getUtilizationSeries(resourceId, metric, new Date(from), new Date(to), Number(intervalMs));
  }
}
