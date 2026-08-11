import { Controller, Get, Post, Param, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RbacGuard } from '../../common/guards/rbac.guard';
import { ControlPlaneGuard } from '../../common/guards/control-plane.guard';
import { TwoPersonControlGuard } from '../../common/guards/two-person-control.guard';
import { SkipTenantScope } from '../../common/decorators/skip-tenant-scope.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { TwoPersonControl } from '../../common/decorators/two-person-control.decorator';
import { TenantExportOffboardingService } from './tenant-export-offboarding.service';

/**
 * Provider-side tenant export and offboarding.
 *
 * M47 / D046: this controller shipped with no `@UseGuards`, no `@Permissions`
 * and no class decorator of any kind, while being mounted in
 * `platform.module.ts`. `POST /platform/v1/offboarding/:tenantId/offboard`
 * terminates a tenant, and the only global APP_GUARD in the application is
 * `TenantThrottlerGuard`, which rate-limits and authorises nobody.
 *
 * The guard chain below is the one `tenant-lifecycle.controller.ts` already
 * uses, and the ordering matters:
 *   - `@SkipTenantScope()` marks these handlers cross-tenant, which is what
 *     arms `ControlPlaneGuard` at all — without it that guard returns true on
 *     its first line and the realm and MFA checks never run.
 *   - the permissions are `system.*` because `hasPermission` only refuses a
 *     tenant `["*"]` grant for codes inside CONTROL_PLANE_NAMESPACES.
 */
@ApiTags('admin')
@ApiBearerAuth()
@Controller('platform/v1/offboarding')
@SkipTenantScope()
@UseGuards(JwtAuthGuard, RbacGuard, ControlPlaneGuard, TwoPersonControlGuard)
export class TenantExportOffboardingController {
  constructor(private readonly offboarding: TenantExportOffboardingService) {}

  @Get(':tenantId/exports')
  @Permissions('system.offboarding.read')
  listExportJobs(@Param('tenantId') tenantId: string) {
    return this.offboarding.listExportJobs(tenantId);
  }

  @Post(':tenantId/export')
  @Permissions('system.offboarding.write')
  startExport(@Param('tenantId') tenantId: string, @Body() body: any) {
    return this.offboarding.startExport({ tenantId, ...body }, body.actorId || 'SYSTEM');
  }

  // Terminates a tenant. Two-person control is not optional here: Track C's
  // own invariant is that "a single operator cannot delete a tenant".
  @Post(':tenantId/offboard')
  @Permissions('system.offboarding.write')
  @TwoPersonControl()
  offboardTenant(
    @Param('tenantId') tenantId: string,
    @Body() body: { reason: string; actorId: string },
  ) {
    return this.offboarding.offboardTenant(tenantId, body.reason, body.actorId || 'SYSTEM');
  }
}
