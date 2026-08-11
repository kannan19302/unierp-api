/**
 * M34 — the correlated trace, console-facing surface.
 */
import { Controller, Get, Param, UseGuards } from "@nestjs/common";
import { ApiTags, ApiOperation, ApiBearerAuth } from "@nestjs/swagger";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RbacGuard } from "../../common/guards/rbac.guard";
import { ControlPlaneGuard } from "../../common/guards/control-plane.guard";
import { Permissions } from "../../common/decorators/permissions.decorator";
import { SkipTenantScope } from "../../common/decorators/skip-tenant-scope.decorator";
import { ObservabilityTraceService } from "./observability-trace.service";

@ApiTags("platform")
@ApiBearerAuth()
@Controller("platform/v1/observability")
@UseGuards(JwtAuthGuard, RbacGuard, ControlPlaneGuard)
@SkipTenantScope()
export class ObservabilityTraceController {
  constructor(private readonly trace: ObservabilityTraceService) {}

  @ApiOperation({ summary: "One correlated view from the console click to the provider call, for a given correlation id" })
  @Get("trace/:correlationId")
  @Permissions("system.observability.read")
  async getTrace(@Param("correlationId") correlationId: string) {
    return this.trace.getCorrelatedTrace(correlationId);
  }
}
