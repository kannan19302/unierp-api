/**
 * M37 — HTTP surface for the retention schedule proven in
 * retention-schedule.service.ts. `read` can inspect the declared classes;
 * `manage` is the only permission that can trigger a real delete run.
 */
import { Controller, Get, Post, Body, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RbacGuard } from "../../common/guards/rbac.guard";
import { ControlPlaneGuard } from "../../common/guards/control-plane.guard";
import { StepUpMfaGuard } from "../../common/guards/step-up-mfa.guard";
import { SkipTenantScope } from "../../common/decorators/skip-tenant-scope.decorator";
import { Permissions } from "../../common/decorators/permissions.decorator";
import { ApiTags, ApiOperation, ApiBearerAuth } from "@nestjs/swagger";
import { RetentionScheduleService, TRACK_M_RETENTION_CLASSES } from "./retention-schedule.service";

interface ExecuteBody {
  dataClass: string;
}

@ApiTags("platform")
@ApiBearerAuth()
@Controller("platform/v1/retention-schedule")
@UseGuards(JwtAuthGuard, RbacGuard, ControlPlaneGuard, StepUpMfaGuard)
@SkipTenantScope()
export class RetentionScheduleController {
  constructor(private readonly retention: RetentionScheduleService) {}

  @ApiOperation({ summary: "List Track M's declared retention classes" })
  @Get("classes")
  @Permissions("system.retention.read")
  async listClasses() {
    return TRACK_M_RETENTION_CLASSES;
  }

  @ApiOperation({ summary: "Execute and certify a retention run for one declared dataClass" })
  @Post("execute")
  @Permissions("system.retention.manage")
  async execute(@Body() body: ExecuteBody) {
    return this.retention.executeAndCertify(body.dataClass);
  }
}
