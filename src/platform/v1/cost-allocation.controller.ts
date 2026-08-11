/**
 * M27 — cost allocation, console-facing surface. The unallocated share
 * is returned in the SAME response as the allocated share — there is no
 * separate endpoint that could be queried while forgetting this one, and
 * no flag that hides it; "never hidden" as an API shape.
 */
import { Controller, Get, Param, UseGuards } from "@nestjs/common";
import { ApiTags, ApiOperation, ApiBearerAuth } from "@nestjs/swagger";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RbacGuard } from "../../common/guards/rbac.guard";
import { ControlPlaneGuard } from "../../common/guards/control-plane.guard";
import { Permissions } from "../../common/decorators/permissions.decorator";
import { SkipTenantScope } from "../../common/decorators/skip-tenant-scope.decorator";
import { CostAllocationService } from "./cost-allocation.service";

@ApiTags("platform")
@ApiBearerAuth()
@Controller("platform/v1/cost-allocation")
@UseGuards(JwtAuthGuard, RbacGuard, ControlPlaneGuard)
@SkipTenantScope()
export class CostAllocationController {
  constructor(private readonly allocation: CostAllocationService) {}

  @ApiOperation({ summary: "Allocate an ingested batch's cost to tenant/service/resource/environment — allocated + unallocated always sums to the ingested total" })
  @Get(":providerId/:period")
  @Permissions("system.costallocation.read")
  async allocate(@Param("providerId") providerId: string, @Param("period") period: string) {
    return this.allocation.allocateBatch(providerId, period);
  }
}
