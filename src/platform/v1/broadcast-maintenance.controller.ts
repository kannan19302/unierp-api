import { Controller, Get, Post, Put, Param, Body } from '@nestjs/common';
import { BroadcastMaintenanceService } from './broadcast-maintenance.service';

@Controller('platform/v1/broadcasts')
export class BroadcastMaintenanceController {
  constructor(private readonly broadcast: BroadcastMaintenanceService) {}

  @Get('windows')
  listMaintenanceWindows() {
    return this.broadcast.listMaintenanceWindows();
  }

  @Post('windows')
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
  cancelMaintenanceWindow(@Param('id') id: string, @Body() body: { actorId: string }) {
    return this.broadcast.cancelMaintenanceWindow(id, body.actorId || 'SYSTEM');
  }

  @Post('message')
  broadcastSystemMessage(@Body() body: any) {
    return this.broadcast.broadcastSystemMessage(body, body.actorId || 'SYSTEM');
  }
}
