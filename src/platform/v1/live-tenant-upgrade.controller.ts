import { Controller, Get, Post, Param, Body, UseGuards } from '@nestjs/common';
import { LiveTenantUpgradeService } from './live-tenant-upgrade.service';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RbacGuard } from '../../common/guards/rbac.guard';
import { ControlPlaneGuard } from '../../common/guards/control-plane.guard';
import { SkipTenantScope } from '../../common/decorators/skip-tenant-scope.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';

/**
 * Live tenant version upgrade (C29's backing surface).
 * M47 / D046: shipped with no authorization guard of any kind. Every route
 * here acts on a tenant named in the URL.
 */
@ApiTags('admin')
@ApiBearerAuth()
@Controller('platform/v1/tenant-upgrades')
@SkipTenantScope()
@UseGuards(JwtAuthGuard, RbacGuard, ControlPlaneGuard)
export class LiveTenantUpgradeController {
  constructor(private readonly liveUpgrade: LiveTenantUpgradeService) {}

  @Get(':tenantId/status')
  @Permissions('system.upgrade.read')
  getUpgradeStatus(@Param('tenantId') tenantId: string) {
    return this.liveUpgrade.getUpgradeStatus(tenantId);
  }

  @Post(':tenantId/compatibility')
  @Permissions('system.upgrade.read')
  checkCompatibility(@Param('tenantId') tenantId: string, @Body() body: { targetVersion: string }) {
    return this.liveUpgrade.checkCompatibility(tenantId, body.targetVersion);
  }

  @Post(':tenantId/upgrade')
  @Permissions('system.upgrade.execute')
  startTenantUpgrade(
    @Param('tenantId') tenantId: string,
    @Body() body: { targetVersion: string; actorId?: string },
  ) {
    return this.liveUpgrade.startTenantUpgrade(tenantId, body.targetVersion, body.actorId || 'SYSTEM');
  }

  @Post(':tenantId/rollback')
  @Permissions('system.upgrade.rollback')
  rollbackTenantUpgrade(
    @Param('tenantId') tenantId: string,
    @Body() body: { previousVersion: string; actorId?: string },
  ) {
    return this.liveUpgrade.rollbackTenantUpgrade(tenantId, body.previousVersion, body.actorId || 'SYSTEM');
  }
}
