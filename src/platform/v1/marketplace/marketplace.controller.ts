import { Controller, Get, Post, Param, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { MarketplaceService } from './marketplace.service';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RbacGuard } from '../../../common/guards/rbac.guard';
import { ControlPlaneGuard } from '../../../common/guards/control-plane.guard';
import { SkipTenantScope } from '../../../common/decorators/skip-tenant-scope.decorator';
import { Permissions } from '../../../common/decorators/permissions.decorator';

@ApiTags('admin')
@ApiBearerAuth()
@Controller('platform/v1/marketplace')
@SkipTenantScope()
@UseGuards(JwtAuthGuard, RbacGuard, ControlPlaneGuard)
export class MarketplaceController {
  constructor(private readonly marketplace: MarketplaceService) {}

  @Get('extensions')
  @Permissions('system.marketplace.read')
  listExtensions() {
    return this.marketplace.listExtensions();
  }

  @Get('submissions')
  @Permissions('system.marketplace.read')
  listSubmissions() {
    return this.marketplace.listSubmissions();
  }

  @Get('extensions/:appSlug/installations')
  @Permissions('system.marketplace.read')
  getInstallations(@Param('appSlug') appSlug: string) {
    return this.marketplace.getExtensionInstallations(appSlug);
  }

  @Post(':id/approve')
  @Permissions('system.marketplace.write')
  approveExtension(@Param('id') id: string, @Body() body: { actorId?: string }) {
    return this.marketplace.approveExtension(id, body?.actorId || 'SYSTEM');
  }

  @Post(':id/reject')
  @Permissions('system.marketplace.write')
  rejectExtension(@Param('id') id: string, @Body() body: { reason: string; actorId?: string }) {
    return this.marketplace.rejectExtension(id, body.reason, body?.actorId || 'SYSTEM');
  }

  @Post('extensions/:appSlug/emergency-revoke')
  @Permissions('system.marketplace.write')
  emergencyRevokeExtension(@Param('appSlug') appSlug: string, @Body() body: { reason: string; actorId?: string }) {
    return this.marketplace.emergencyRevokeExtension(appSlug, body.reason, body?.actorId || 'SYSTEM');
  }
}

