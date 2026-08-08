import { Module } from '@nestjs/common';
import { MarketplaceController } from './marketplace.controller';
import { MarketplaceService } from './marketplace.service';
import { ControlPlaneAuditService } from '../control-plane-audit.service';

@Module({
  controllers: [MarketplaceController],
  providers: [MarketplaceService, ControlPlaneAuditService],
  exports: [MarketplaceService],
})
export class MarketplaceModule {}
