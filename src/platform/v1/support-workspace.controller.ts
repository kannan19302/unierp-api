import { Controller, Get, Post, Param, Body, Query, UseGuards } from '@nestjs/common';
import { SupportWorkspaceService } from './support-workspace.service';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RbacGuard } from '../../common/guards/rbac.guard';
import { ControlPlaneGuard } from '../../common/guards/control-plane.guard';
import { SkipTenantScope } from '../../common/decorators/skip-tenant-scope.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { TrackChanges } from '../../common/decorators/track-changes.decorator';

/**
 * Support workspace (C20's backing surface).
 * M47 / D046: shipped with no authorization guard of any kind. Every route
 * here acts on a tenant named in the URL.
 */
@ApiTags('admin')
@ApiBearerAuth()
@Controller('platform/v1/support')
@SkipTenantScope()
@UseGuards(JwtAuthGuard, RbacGuard, ControlPlaneGuard)
export class SupportWorkspaceController {
  constructor(private readonly support: SupportWorkspaceService) {}

  @Get(':tenantId/health')
  @Permissions('system.support.read')
  getTenantHealth(@Param('tenantId') tenantId: string) {
    return this.support.getTenantHealth(tenantId);
  }

  @Get(':tenantId/tickets')
  @Permissions('system.support.read')
  listTickets(@Param('tenantId') tenantId: string, @Query('status') status?: string) {
    return this.support.listTickets(tenantId, status);
  }

  @Post('tickets/:ticketId/resolve')
  @Permissions('system.support.write')
  resolveTicket(
    @Param('ticketId') ticketId: string,
    @Body() body: { resolution: string; actorId: string },
  ) {
    return this.support.resolveTicket(ticketId, body.resolution, body.actorId || 'SYSTEM');
  }

  @Get(':tenantId/session-replay')
  @Permissions('system.support.read')
  getSessionReplayPointers(@Param('tenantId') tenantId: string) {
    return this.support.getSessionReplayPointers(tenantId);
  }
}
