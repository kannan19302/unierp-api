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
  constructor(private readonly releaseControl: ReleaseControlService) {}

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
}
