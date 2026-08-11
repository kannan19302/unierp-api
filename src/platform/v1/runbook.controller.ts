/**
 * M45 — HTTP surface for the runbook mechanism proven in runbook.service.ts.
 */
import { Controller, Get, Post, Param, Body, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RbacGuard } from "../../common/guards/rbac.guard";
import { ControlPlaneGuard } from "../../common/guards/control-plane.guard";
import { StepUpMfaGuard } from "../../common/guards/step-up-mfa.guard";
import { SkipTenantScope } from "../../common/decorators/skip-tenant-scope.decorator";
import { Permissions } from "../../common/decorators/permissions.decorator";
import { ApiTags, ApiOperation, ApiBearerAuth } from "@nestjs/swagger";
import { RunbookService, type RunbookStep } from "./runbook.service";

interface AuthorBody {
  name: string;
  steps: RunbookStep[];
}

interface PublishBody {
  policyName: string;
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
  constructor(private readonly runbooks: RunbookService) {}

  @ApiOperation({ summary: "Author a new runbook (DRAFT)" })
  @Post()
  @Permissions("system.runbook.manage")
  async author(@Body() body: AuthorBody) {
    return this.runbooks.authorRunbook(body.name, body.steps);
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
    return this.runbooks.publishRunbook(id, body.policyName);
  }

  @ApiOperation({ summary: "Execute a published runbook from an incident, two-person approved" })
  @Post(":id/execute")
  @Permissions("system.runbook.manage")
  async execute(@Param("id") id: string, @Body() body: ExecuteBody) {
    return this.runbooks.executeFromIncident(id, body.incidentId, body.requestedBy, body.approvedBy);
  }
}
