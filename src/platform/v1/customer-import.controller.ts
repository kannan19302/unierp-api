import { Controller, Get, Post, Param, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RbacGuard } from '../../common/guards/rbac.guard';
import { ControlPlaneGuard } from '../../common/guards/control-plane.guard';
import { SkipTenantScope } from '../../common/decorators/skip-tenant-scope.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { CustomerImportService } from './customer-import.service';

/**
 * Provider-assisted customer data import (C23's backing surface).
 * M47 / D046: shipped with no guard, while writing data into a tenant named
 * in the URL.
 */
@ApiTags('admin')
@ApiBearerAuth()
@Controller('platform/v1/imports')
@SkipTenantScope()
@UseGuards(JwtAuthGuard, RbacGuard, ControlPlaneGuard)
export class CustomerImportController {
  constructor(private readonly importService: CustomerImportService) {}

  @Get(':tenantId')
  @Permissions('system.import.read')
  listImportJobs(@Param('tenantId') tenantId: string) {
    return this.importService.listImportJobs(tenantId);
  }

  @Post(':tenantId/validate')
  @Permissions('system.import.write')
  validateImport(@Param('tenantId') tenantId: string, @Body() body: any) {
    return this.importService.validateImport({ tenantId, ...body }, body.actorId || 'SYSTEM');
  }

  @Post('jobs/:jobId/execute')
  @Permissions('system.import.write')
  executeImport(@Param('jobId') jobId: string, @Body() body: { actorId: string }) {
    return this.importService.executeImport(jobId, body.actorId || 'SYSTEM');
  }
}
