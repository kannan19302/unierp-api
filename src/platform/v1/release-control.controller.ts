import { Controller, Get, Post, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RbacGuard } from '../../common/guards/rbac.guard';
import { ControlPlaneGuard } from '../../common/guards/control-plane.guard';
import { TwoPersonControlGuard } from '../../common/guards/two-person-control.guard';
import { SkipTenantScope } from '../../common/decorators/skip-tenant-scope.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { TwoPersonControl } from '../../common/decorators/two-person-control.decorator';
import { ReleaseControlService } from './release-control.service';
import { ReleasePromotionService } from './release-promotion.service';

/**
 * Release control (C27's backing surface).
 *
 * M47 / D046: shipped unguarded. `POST /platform/v1/releases/rollback` rolls
 * the entire platform back to a previous manifest — the single widest blast
 * radius in plane 1 — and was reachable by anyone who could reach the port.
 */
@ApiTags('admin')
@ApiBearerAuth()
@Controller('platform/v1/releases')
@SkipTenantScope()
@UseGuards(JwtAuthGuard, RbacGuard, ControlPlaneGuard, TwoPersonControlGuard)
export class ReleaseControlController {
  constructor(
    private readonly releaseControl: ReleaseControlService,
    private readonly promotionService: ReleasePromotionService,
  ) {}

  @Get('manifest')
  @Permissions('system.release.read')
  getCurrentManifest() {
    return this.releaseControl.getCurrentManifest();
  }

  // Platform-wide and destructive: every tenant is affected at once.
  @Post('rollback')
  @Permissions('system.release.rollback')
  @TwoPersonControl()
  triggerRollback(@Body() body: { targetManifestVersion: string; reason: string; actorId?: string }) {
    return this.releaseControl.triggerRollback(body, body.actorId || 'SYSTEM');
  }

  /**
   * M20 — a promotion as a plan with a health gate, not a manual step. The
   * caller supplies the health signal (`healthy`) because the actual
   * health probe — synthetic checks, smoke tests, whatever the environment
   * runs post-deploy — is outside this platform's scope; what this
   * endpoint owns is what happens with that signal: DONE and desired
   * state moves to the target manifest, or COMPENSATED and desired state
   * reverts to the previous one, automatically, inside the same call.
   */
  @Post('promote')
  @Permissions('system.release.promote')
  promote(@Body() body: { environmentName: string; targetManifestVersion: string; healthy: boolean }) {
    return this.promotionService.promote(body.environmentName, body.targetManifestVersion, async () => body.healthy);
  }
}
