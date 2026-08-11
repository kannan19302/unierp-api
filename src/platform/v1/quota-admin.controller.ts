import { Controller, Get, Post, Param, Body, Query, UseGuards } from '@nestjs/common';
import { QuotaAdminService } from './quota-admin.service';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RbacGuard } from '../../common/guards/rbac.guard';
import { ControlPlaneGuard } from '../../common/guards/control-plane.guard';
import { SkipTenantScope } from '../../common/decorators/skip-tenant-scope.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { TrackChanges } from '../../common/decorators/track-changes.decorator';

/**
 * Quota and limit administration (C18's backing surface).
 * M47 / D046: shipped with no authorization guard of any kind. Every route
 * here acts on a tenant named in the URL.
 */
@ApiTags('admin')
@ApiBearerAuth()
@Controller('platform/v1/quotas')
@SkipTenantScope()
@UseGuards(JwtAuthGuard, RbacGuard, ControlPlaneGuard)
export class QuotaAdminController {
  constructor(private readonly quota: QuotaAdminService) {}

  @Get('rules')
  @Permissions('system.quota.read')
  listQuotaRules(@Query('planId') planId?: string) {
    return this.quota.listQuotaRules(planId);
  }

  @Post('rules')
  @Permissions('system.quota.write')
  @TrackChanges('QuotaRule')
  setQuotaRule(@Body() body: any) {
    return this.quota.setQuotaRule(body, body.actorId || 'SYSTEM');
  }

  @Get(':tenantId/usage')
  @Permissions('system.quota.read')
  getUsageWithQuotas(@Param('tenantId') tenantId: string) {
    return this.quota.getUsageWithQuotas(tenantId);
  }

  @Post(':tenantId/alert')
  @Permissions('system.quota.write')
  @TrackChanges('Tenant')
  logUsageAlert(@Param('tenantId') tenantId: string, @Body() body: any) {
    return this.quota.logUsageAlert(tenantId, body.metric, body.currentValue, body.limitValue, body.actorId || 'SYSTEM');
  }
}
