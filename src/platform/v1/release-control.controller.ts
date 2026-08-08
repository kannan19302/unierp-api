import { Controller, Get, Post, Body } from '@nestjs/common';
import { ReleaseControlService } from './release-control.service';

@Controller('platform/v1/releases')
export class ReleaseControlController {
  constructor(private readonly releaseControl: ReleaseControlService) {}

  @Get('manifest')
  getCurrentManifest() {
    return this.releaseControl.getCurrentManifest();
  }

  @Post('rollback')
  triggerRollback(@Body() body: { targetManifestVersion: string; reason: string; actorId?: string }) {
    return this.releaseControl.triggerRollback(body, body.actorId || 'SYSTEM');
  }
}
