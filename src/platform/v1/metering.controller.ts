import { Controller, Get, Post, Body, Param, Req } from '@nestjs/common';
import { MeteringService, RecordEventDto } from './metering.service';
import { Request } from 'express';

@Controller('platform/v1/metering')
export class MeteringController {
  constructor(private readonly meteringService: MeteringService) {}

  @Get(':tenantId/usage')
  async getUsage(@Param('tenantId') tenantId: string) {
    return this.meteringService.getUsage(tenantId);
  }

  @Get(':tenantId/events/:metric')
  async getEvents(
    @Param('tenantId') tenantId: string,
    @Param('metric') metric: string,
  ) {
    return this.meteringService.getEvents(tenantId, metric);
  }

  @Post(':tenantId/events')
  async recordEvent(
    @Param('tenantId') tenantId: string,
    @Body() dto: RecordEventDto,
    @Req() req: Request,
  ) {
    return this.meteringService.recordEvent(tenantId, dto, (req as any).user?.id || 'SUPER_ADMIN');
  }

  @Post(':tenantId/reconcile/:metric')
  async reconcile(
    @Param('tenantId') tenantId: string,
    @Param('metric') metric: string,
    @Req() req: Request,
  ) {
    return this.meteringService.reconcile(tenantId, metric, (req as any).user?.id || 'SUPER_ADMIN');
  }
}
