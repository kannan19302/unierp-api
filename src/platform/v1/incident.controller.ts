/**
 * M35 — incidents/SLA, console-facing surface.
 */
import { Controller, Get, Post, Patch, Param, Query, Body, UseGuards, Optional } from "@nestjs/common";
import { ApiTags, ApiOperation, ApiBearerAuth } from "@nestjs/swagger";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RbacGuard } from "../../common/guards/rbac.guard";
import { ControlPlaneGuard } from "../../common/guards/control-plane.guard";
import { Permissions } from "../../common/decorators/permissions.decorator";
import { SkipTenantScope } from "../../common/decorators/skip-tenant-scope.decorator";
import { IncidentService } from "./incident.service";
import { ConsoleGateway } from "./console.gateway";
import { ControlPlaneAuditService } from "./control-plane-audit.service";

@ApiTags("platform")
@ApiBearerAuth()
@Controller("platform/v1/incidents")
@UseGuards(JwtAuthGuard, RbacGuard, ControlPlaneGuard)
@SkipTenantScope()
export class IncidentController {
  constructor(
    private readonly incidents: IncidentService,
    @Optional() private readonly gateway?: ConsoleGateway,
    @Optional() private readonly audit?: ControlPlaneAuditService,
  ) {}

  @ApiOperation({ summary: "List all platform incidents with status and severity filters" })
  @Get()
  @Permissions("system.incident.read")
  async list(
    @Query("status") status?: string,
    @Query("severity") severity?: string,
    @Query("search") search?: string,
  ) {
    return this.incidents.listIncidents({ status, severity, search });
  }

  @ApiOperation({ summary: "Get single incident with timeline event stream" })
  @Get(":id")
  @Permissions("system.incident.read")
  async getOne(@Param("id") id: string) {
    return this.incidents.getIncident(id);
  }

  @ApiOperation({ summary: "Escalate incident severity level" })
  @Patch(":id/escalate")
  @Permissions("system.incident.manage")
  async escalate(
    @Param("id") id: string,
    @Body() body: { severity: "MINOR" | "MAJOR" | "CRITICAL"; note?: string; actorId?: string },
  ) {
    const actorId = body.actorId || "SYSTEM";
    const result = await this.incidents.escalateSeverity(id, body.severity, actorId, body.note);
    await this.audit?.record({
      actorId,
      actorRole: "SUPER_ADMIN",
      action: "incident.escalated",
      targetId: id,
      details: { newSeverity: body.severity, note: body.note },
    });
    this.gateway?.broadcastToAdmins("incident.escalated", result);
    return result;
  }

  @ApiOperation({ summary: "Resolve incident with root cause and corrective action" })
  @Patch(":id/resolve")
  @Permissions("system.incident.manage")
  async resolve(
    @Param("id") id: string,
    @Body() body: { rootCause: string; correctiveAction: string; actorId?: string },
  ) {
    const actorId = body.actorId || "SYSTEM";
    const result = await this.incidents.resolveIncident(id, body.rootCause, body.correctiveAction, actorId);
    await this.audit?.record({
      actorId,
      actorRole: "SUPER_ADMIN",
      action: "incident.resolved",
      targetId: id,
      details: { rootCause: body.rootCause, correctiveAction: body.correctiveAction },
    });
    this.gateway?.broadcastToAdmins("incident.resolved", result);
    return result;
  }

  @ApiOperation({ summary: "Simulate an SLO breach: opens an incident, notifies via C21, applies an SLA credit to C16 as an adjustment" })
  @Post("simulate-breach")
  @Permissions("system.incident.manage")
  async simulateBreach(@Body() body: { sloDefinitionId: string; invoiceId: string; actualPercent: number; actorId: string }) {
    return this.incidents.simulateBreach(body.sloDefinitionId, body.invoiceId, body.actualPercent, body.actorId);
  }
}
