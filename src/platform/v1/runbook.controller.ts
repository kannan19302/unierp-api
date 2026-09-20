/**
 * M45 — HTTP surface for the runbook mechanism proven in runbook.service.ts.
 */
import { Controller, Get, Post, Delete, Param, Body, Query, UseGuards, Optional } from "@nestjs/common";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RbacGuard } from "../../common/guards/rbac.guard";
import { ControlPlaneGuard } from "../../common/guards/control-plane.guard";
import { StepUpMfaGuard } from "../../common/guards/step-up-mfa.guard";
import { SkipTenantScope } from "../../common/decorators/skip-tenant-scope.decorator";
import { Permissions } from "../../common/decorators/permissions.decorator";
import { ApiTags, ApiOperation, ApiBearerAuth } from "@nestjs/swagger";
import { RunbookService, type RunbookStep } from "./runbook.service";
import { ConsoleGateway } from "./console.gateway";
import { ControlPlaneAuditService } from "./control-plane-audit.service";

interface AuthorBody {
  name: string;
  steps: RunbookStep[];
  actorId?: string;
}

interface PublishBody {
  policyName: string;
  actorId?: string;
}

interface ExecuteBody {
  incidentId: string;
  requestedBy: string;
  approvedBy: string;
}

@ApiTags("platform")
@ApiBearerAuth()
@Controller("platform/v1/runbooks")
@UseGuards(JwtAuthGuard, RbacGuard, ControlPlaneGuard, StepUpMfaGuard)
@SkipTenantScope()
export class RunbookController {
  constructor(
    private readonly runbooks: RunbookService,
    @Optional() private readonly gateway?: ConsoleGateway,
    @Optional() private readonly audit?: ControlPlaneAuditService,
  ) {}

  @ApiOperation({ summary: "List all runbooks with optional search" })
  @Get()
  @Permissions("system.runbook.read")
  async list(@Query("search") search?: string) {
    return this.runbooks.listRunbooks({ search });
  }

  @ApiOperation({ summary: "Get a specific runbook by ID" })
  @Get(":id")
  @Permissions("system.runbook.read")
  async getOne(@Param("id") id: string) {
    return this.runbooks.getRunbook(id);
  }

  @ApiOperation({ summary: "Author a new runbook (DRAFT)" })
  @Post()
  @Permissions("system.runbook.manage")
  async author(@Body() body: AuthorBody) {
    const result = await this.runbooks.authorRunbook(body.name, body.steps);
    await this.audit?.record({
      actorId: body.actorId || "SYSTEM",
      actorRole: "SUPER_ADMIN",
      action: "runbook.created",
      targetId: result.id,
      details: { name: body.name, stepCount: body.steps.length },
    });
    this.gateway?.broadcastToAdmins("runbook.created", result);
    return result;
  }

  @ApiOperation({ summary: "Dry-run a runbook's steps — no side effect" })
  @Get(":id/dry-run")
  @Permissions("system.runbook.read")
  async dryRun(@Param("id") id: string) {
    return this.runbooks.dryRunRunbook(id);
  }

  @ApiOperation({ summary: "Publish a runbook — refused if any step breaches M08 policy" })
  @Post(":id/publish")
  @Permissions("system.runbook.manage")
  async publish(@Param("id") id: string, @Body() body: PublishBody) {
    const result = await this.runbooks.publishRunbook(id, body.policyName);
    await this.audit?.record({
      actorId: body.actorId || "SYSTEM",
      actorRole: "SUPER_ADMIN",
      action: "runbook.published",
      targetId: id,
      details: { policyName: body.policyName },
    });
    this.gateway?.broadcastToAdmins("runbook.published", result);
    return result;
  }

  @ApiOperation({ summary: "Execute a published runbook from an incident, two-person approved" })
  @Post(":id/execute")
  @Permissions("system.runbook.manage")
  async execute(@Param("id") id: string, @Body() body: ExecuteBody) {
    const result = await this.runbooks.executeFromIncident(id, body.incidentId, body.requestedBy, body.approvedBy);
    this.gateway?.broadcastToAdmins("runbook.executed", { runbookId: id, executionId: result.execution.id });
    return result;
  }

  @ApiOperation({ summary: "Delete / decommission a runbook" })
  @Delete(":id")
  @Permissions("system.runbook.manage")
  async delete(@Param("id") id: string, @Query("actorId") actorId?: string) {
    const result = await this.runbooks.deleteRunbook(id);
    await this.audit?.record({
      actorId: actorId || "SYSTEM",
      actorRole: "SUPER_ADMIN",
      action: "runbook.deleted",
      targetId: id,
      details: {},
    });
    this.gateway?.broadcastToAdmins("runbook.deleted", { id });
    return result;
  }
}
