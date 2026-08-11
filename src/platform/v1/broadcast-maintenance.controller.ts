import { Controller, Get, Post, Put, Param, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RbacGuard } from '../../common/guards/rbac.guard';
import { ControlPlaneGuard } from '../../common/guards/control-plane.guard';
import { SkipTenantScope } from '../../common/decorators/skip-tenant-scope.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { BroadcastMaintenanceService } from './broadcast-maintenance.service';

/**
 * Platform broadcasts and maintenance windows (C21's backing surface).
 * M47 / D046: shipped with no guard. `POST /broadcasts/message` reaches every
 * tenant in the platform at once.
 */
@ApiTags('admin')
@ApiBearerAuth()
@Controller('platform/v1/broadcasts')
@SkipTenantScope()
@UseGuards(JwtAuthGuard, RbacGuard, ControlPlaneGuard)
export class BroadcastMaintenanceController {
  constructor(private readonly broadcast: BroadcastMaintenanceService) {}

  @Get('windows')
  @Permissions('system.broadcast.read')
  listMaintenanceWindows() {
    return this.broadcast.listMaintenanceWindows();
  }

  @Post('windows')
  @Permissions('system.broadcast.write')
  scheduleMaintenanceWindow(@Body() body: any) {
    return this.broadcast.scheduleMaintenanceWindow(
      {
        ...body,
        startTime: new Date(body.startTime),
        endTime: new Date(body.endTime),
      },
      body.actorId || 'SYSTEM',
    );
  }

  @Put('windows/:id/cancel')
  @Permissions('system.broadcast.write')
  cancelMaintenanceWindow(@Param('id') id: string, @Body() body: { actorId: string }) {
    return this.broadcast.cancelMaintenanceWindow(id, body.actorId || 'SYSTEM');
  }

  @Post('message')
  @Permissions('system.broadcast.write')
  broadcastSystemMessage(@Body() body: any) {
    return this.broadcast.broadcastSystemMessage(body, body.actorId || 'SYSTEM');
  }
}
