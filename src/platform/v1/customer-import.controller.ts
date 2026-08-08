import { Controller, Get, Post, Param, Body } from '@nestjs/common';
import { CustomerImportService } from './customer-import.service';

@Controller('platform/v1/imports')
export class CustomerImportController {
  constructor(private readonly importService: CustomerImportService) {}

  @Get(':tenantId')
  listImportJobs(@Param('tenantId') tenantId: string) {
    return this.importService.listImportJobs(tenantId);
  }

  @Post(':tenantId/validate')
  validateImport(@Param('tenantId') tenantId: string, @Body() body: any) {
    return this.importService.validateImport({ tenantId, ...body }, body.actorId || 'SYSTEM');
  }

  @Post('jobs/:jobId/execute')
  executeImport(@Param('jobId') jobId: string, @Body() body: { actorId: string }) {
    return this.importService.executeImport(jobId, body.actorId || 'SYSTEM');
  }
}
