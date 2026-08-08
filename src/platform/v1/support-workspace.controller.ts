import { Controller, Get, Post, Param, Body, Query } from '@nestjs/common';
import { SupportWorkspaceService } from './support-workspace.service';

@Controller('platform/v1/support')
export class SupportWorkspaceController {
  constructor(private readonly support: SupportWorkspaceService) {}

  @Get(':tenantId/health')
  getTenantHealth(@Param('tenantId') tenantId: string) {
    return this.support.getTenantHealth(tenantId);
  }

  @Get(':tenantId/tickets')
  listTickets(@Param('tenantId') tenantId: string, @Query('status') status?: string) {
    return this.support.listTickets(tenantId, status);
  }

  @Post('tickets/:ticketId/resolve')
  resolveTicket(
    @Param('ticketId') ticketId: string,
    @Body() body: { resolution: string; actorId: string },
  ) {
    return this.support.resolveTicket(ticketId, body.resolution, body.actorId || 'SYSTEM');
  }

  @Get(':tenantId/session-replay')
  getSessionReplayPointers(@Param('tenantId') tenantId: string) {
    return this.support.getSessionReplayPointers(tenantId);
  }
}
