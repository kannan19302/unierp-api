import { Controller, Get, Post, Param, Body } from '@nestjs/common';
import { TenantExportOffboardingService } from './tenant-export-offboarding.service';

@Controller('platform/v1/offboarding')
export class TenantExportOffboardingController {
  constructor(private readonly offboarding: TenantExportOffboardingService) {}

  @Get(':tenantId/exports')
  listExportJobs(@Param('tenantId') tenantId: string) {
    return this.offboarding.listExportJobs(tenantId);
  }

  @Post(':tenantId/export')
  startExport(@Param('tenantId') tenantId: string, @Body() body: any) {
    return this.offboarding.startExport({ tenantId, ...body }, body.actorId || 'SYSTEM');
  }

  @Post(':tenantId/offboard')
  offboardTenant(
    @Param('tenantId') tenantId: string,
    @Body() body: { reason: string; actorId: string },
  ) {
    return this.offboarding.offboardTenant(tenantId, body.reason, body.actorId || 'SYSTEM');
  }
}
