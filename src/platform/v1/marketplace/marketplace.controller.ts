import { Controller, Get, Post, Param, Body } from '@nestjs/common';
import { MarketplaceService } from './marketplace.service';

@Controller('platform/v1/marketplace')
export class MarketplaceController {
  constructor(private readonly marketplace: MarketplaceService) {}

  @Get('extensions')
  listExtensions() {
    return this.marketplace.listExtensions();
  }

  @Get('submissions')
  listSubmissions() {
    return this.marketplace.listSubmissions();
  }

  @Get('extensions/:appSlug/installations')
  getInstallations(@Param('appSlug') appSlug: string) {
    return this.marketplace.getExtensionInstallations(appSlug);
  }

  @Post(':id/approve')
  approveExtension(@Param('id') id: string, @Body() body: { actorId: string }) {
    return this.marketplace.approveExtension(id, body.actorId || 'SYSTEM');
  }

  @Post(':id/reject')
  rejectExtension(@Param('id') id: string, @Body() body: { reason: string; actorId: string }) {
    return this.marketplace.rejectExtension(id, body.reason, body.actorId || 'SYSTEM');
  }

  @Post('extensions/:appSlug/emergency-revoke')
  emergencyRevokeExtension(@Param('appSlug') appSlug: string, @Body() body: { reason: string; actorId: string }) {
    return this.marketplace.emergencyRevokeExtension(appSlug, body.reason, body.actorId || 'SYSTEM');
  }
}
