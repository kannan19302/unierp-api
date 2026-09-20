/**
 * M38 — HTTP surface for the compliance control mechanism proven in
 * compliance-control.service.ts. `read` can view the catalogue,
 * monitoring status and exported evidence; `manage` can run a
 * monitoring pass or export evidence from the real audit spine.
 */
import { Controller, Get, Post, Patch, Delete, Param, Body, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RbacGuard } from "../../common/guards/rbac.guard";
import { ControlPlaneGuard } from "../../common/guards/control-plane.guard";
import { StepUpMfaGuard } from "../../common/guards/step-up-mfa.guard";
import { SkipTenantScope } from "../../common/decorators/skip-tenant-scope.decorator";
import { Permissions } from "../../common/decorators/permissions.decorator";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { ApiTags, ApiOperation, ApiBearerAuth } from "@nestjs/swagger";
import { ComplianceControlService } from "./compliance-control.service";

interface ExportBody {
  auditorQuestion: string;
}

@ApiTags("platform")
@ApiBearerAuth()
@Controller("platform/v1/compliance-controls")
@UseGuards(JwtAuthGuard, RbacGuard, ControlPlaneGuard, StepUpMfaGuard)
@SkipTenantScope()
export class ComplianceControlController {
  constructor(private readonly compliance: ComplianceControlService) {}

  @ApiOperation({ summary: "List compliance frameworks and coverage posture" })
  @Get("frameworks")
  @Permissions("system.compliance.read")
  async listFrameworks() {
    return this.compliance.listFrameworks();
  }

  @ApiOperation({ summary: "List all exported evidence artefacts" })
  @Get("evidence")
  @Permissions("system.compliance.read")
  async listAllEvidence() {
    return this.compliance.listAllEvidence();
  }

  @ApiOperation({ summary: "List the control catalogue mapped to frameworks" })
  @Get()
  @Permissions("system.compliance.read")
  async listCatalogue() {
    return this.compliance.listCatalogue();
  }

  @ApiOperation({ summary: "Register a new custom compliance control" })
  @Post()
  @Permissions("system.compliance.manage")
  async createControl(
    @Body()
    body: {
      code: string;
      title: string;
      frameworks: string;
      description: string;
      minRecords?: number;
    }
  ) {
    return this.compliance.createControl(body);
  }

  @ApiOperation({ summary: "Run continuous control monitoring across the whole catalogue" })
  @Post("monitor")
  @Permissions("system.compliance.manage")
  async runMonitoring() {
    return this.compliance.runMonitoring();
  }

  @ApiOperation({ summary: "Update an existing compliance control" })
  @Patch(":code")
  @Permissions("system.compliance.manage")
  async updateControl(
    @Param("code") code: string,
    @Body() body: { title?: string; frameworks?: string; description?: string }
  ) {
    return this.compliance.updateControl(code, body);
  }

  @ApiOperation({ summary: "Delete a custom compliance control" })
  @Delete(":code")
  @Permissions("system.compliance.manage")
  async deleteControl(@Param("code") code: string) {
    return this.compliance.deleteControl(code);
  }

  @ApiOperation({ summary: "Evaluate one control against the real audit spine" })
  @Post(":code/evaluate")
  @Permissions("system.compliance.manage")
  async evaluate(@Param("code") code: string) {
    return this.compliance.evaluateControl(code);
  }

  @ApiOperation({ summary: "Export evidence for a control, generated from real audit records" })
  @Post(":code/evidence")
  @Permissions("system.compliance.manage")
  async exportEvidence(
    @Param("code") code: string,
    @Body() body: ExportBody,
    @CurrentUser() user: any,
  ) {
    return this.compliance.exportEvidence(code, body.auditorQuestion, user?.userId ?? "unknown");
  }

  @ApiOperation({ summary: "List previously exported evidence artefacts for a control" })
  @Get(":code/evidence")
  @Permissions("system.compliance.read")
  async listEvidence(@Param("code") code: string) {
    return this.compliance.listEvidence(code);
  }
}