import { Controller, Get, Post, Param, Body, Request, UseGuards } from '@nestjs/common';
import { DunningService, DunningStep } from './dunning.service';

@Controller('platform/v1/dunning')
export class DunningController {
  constructor(private readonly dunning: DunningService) {}

  @Get('status/:tenantId')
  getDunningStatus(@Param('tenantId') tenantId: string) {
    return this.dunning.getDunningStatus(tenantId);
  }

  @Post(':tenantId/execute')
  executeDunningStep(
    @Param('tenantId') tenantId: string,
    @Body() body: { step: DunningStep; actorId: string },
  ) {
    return this.dunning.executeDunningStep(tenantId, body.step, body.actorId || 'SYSTEM');
  }

  @Post(':tenantId/recover')
  recoverFromDunning(@Param('tenantId') tenantId: string, @Body() body: { actorId: string }) {
    return this.dunning.recoverFromDunning(tenantId, body.actorId || 'SYSTEM');
  }
}
