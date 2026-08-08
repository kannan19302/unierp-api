import { Controller, Get, Post, Param, Body } from '@nestjs/common';
import { LiveTenantUpgradeService } from './live-tenant-upgrade.service';

@Controller('platform/v1/tenant-upgrades')
export class LiveTenantUpgradeController {
  constructor(private readonly liveUpgrade: LiveTenantUpgradeService) {}

  @Get(':tenantId/status')
  getUpgradeStatus(@Param('tenantId') tenantId: string) {
    return this.liveUpgrade.getUpgradeStatus(tenantId);
  }

  @Post(':tenantId/compatibility')
  checkCompatibility(@Param('tenantId') tenantId: string, @Body() body: { targetVersion: string }) {
    return this.liveUpgrade.checkCompatibility(tenantId, body.targetVersion);
  }

  @Post(':tenantId/upgrade')
  startTenantUpgrade(
    @Param('tenantId') tenantId: string,
    @Body() body: { targetVersion: string; actorId?: string },
  ) {
    return this.liveUpgrade.startTenantUpgrade(tenantId, body.targetVersion, body.actorId || 'SYSTEM');
  }

  @Post(':tenantId/rollback')
  rollbackTenantUpgrade(
    @Param('tenantId') tenantId: string,
    @Body() body: { previousVersion: string; actorId?: string },
  ) {
    return this.liveUpgrade.rollbackTenantUpgrade(tenantId, body.previousVersion, body.actorId || 'SYSTEM');
  }
}
