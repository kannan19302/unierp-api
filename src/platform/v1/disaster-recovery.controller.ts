/**
 * M36 — backup/restore/DR/failover, console-facing surface.
 */
import { Controller, Post, Param, Body, UseGuards } from "@nestjs/common";
import { ApiTags, ApiOperation, ApiBearerAuth } from "@nestjs/swagger";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RbacGuard } from "../../common/guards/rbac.guard";
import { ControlPlaneGuard } from "../../common/guards/control-plane.guard";
import { Permissions } from "../../common/decorators/permissions.decorator";
import { SkipTenantScope } from "../../common/decorators/skip-tenant-scope.decorator";
import { DisasterRecoveryService } from "./disaster-recovery.service";

@ApiTags("platform")
@ApiBearerAuth()
@Controller("platform/v1/disaster-recovery")
@UseGuards(JwtAuthGuard, RbacGuard, ControlPlaneGuard)
@SkipTenantScope()
export class DisasterRecoveryController {
  constructor(private readonly dr: DisasterRecoveryService) {}

  @ApiOperation({ summary: "Set a resource's backup RPO/RTO objectives" })
  @Post(":resourceId/backup-policy")
  @Permissions("system.disasterrecovery.rehearse")
  async setBackupPolicy(@Param("resourceId") resourceId: string, @Body() body: { rpoObjectiveMinutes: number; rtoObjectiveMinutes: number }) {
    return this.dr.setBackupPolicy(resourceId, body.rpoObjectiveMinutes, body.rtoObjectiveMinutes);
  }

  @ApiOperation({ summary: "Rehearse a restore: measured RPO/RTO recorded against the objective; a miss is a failure" })
  @Post(":resourceId/rehearse-restore")
  @Permissions("system.disasterrecovery.rehearse")
  async rehearseRestore(
    @Param("resourceId") resourceId: string,
    @Body()
    body: {
      backedUpState: Record<string, unknown>;
      lastBackupAt: string;
      failureAt: string;
      restoreStartedAt: string;
      restoreCompletedAt: string;
    },
  ) {
    return this.dr.rehearseRestore(
      resourceId,
      body.backedUpState,
      new Date(body.lastBackupAt),
      new Date(body.failureAt),
      new Date(body.restoreStartedAt),
      new Date(body.restoreCompletedAt),
    );
  }

  @ApiOperation({ summary: "Rehearse a region failover" })
  @Post(":resourceId/rehearse-failover")
  @Permissions("system.disasterrecovery.rehearse")
  async rehearseFailover(@Param("resourceId") resourceId: string, @Body() body: { fromRegion: string; toRegion: string }) {
    return this.dr.rehearseFailover(resourceId, body.fromRegion, body.toRegion);
  }

  @ApiOperation({ summary: "Rehearse the failback for a prior failover rehearsal" })
  @Post("failover/:rehearsalId/failback")
  @Permissions("system.disasterrecovery.rehearse")
  async rehearseFailback(@Param("rehearsalId") rehearsalId: string) {
    return this.dr.rehearseFailback(rehearsalId);
  }
}
