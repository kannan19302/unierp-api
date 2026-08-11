/**
 * M35 — incidents/SLA, console-facing surface.
 */
import { Controller, Post, Body, UseGuards } from "@nestjs/common";
import { ApiTags, ApiOperation, ApiBearerAuth } from "@nestjs/swagger";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RbacGuard } from "../../common/guards/rbac.guard";
import { ControlPlaneGuard } from "../../common/guards/control-plane.guard";
import { Permissions } from "../../common/decorators/permissions.decorator";
import { SkipTenantScope } from "../../common/decorators/skip-tenant-scope.decorator";
import { IncidentService } from "./incident.service";

@ApiTags("platform")
@ApiBearerAuth()
@Controller("platform/v1/incidents")
@UseGuards(JwtAuthGuard, RbacGuard, ControlPlaneGuard)
@SkipTenantScope()
export class IncidentController {
  constructor(private readonly incidents: IncidentService) {}

  @ApiOperation({ summary: "Simulate an SLO breach: opens an incident, notifies via C21, applies an SLA credit to C16 as an adjustment" })
  @Post("simulate-breach")
  @Permissions("system.incident.manage")
  async simulateBreach(@Body() body: { sloDefinitionId: string; invoiceId: string; actualPercent: number; actorId: string }) {
    return this.incidents.simulateBreach(body.sloDefinitionId, body.invoiceId, body.actualPercent, body.actorId);
  }
}
