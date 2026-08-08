import { Controller, Get, Post, Param, Body, Query } from '@nestjs/common';
import { QuotaAdminService } from './quota-admin.service';

@Controller('platform/v1/quotas')
export class QuotaAdminController {
  constructor(private readonly quota: QuotaAdminService) {}

  @Get('rules')
  listQuotaRules(@Query('planId') planId?: string) {
    return this.quota.listQuotaRules(planId);
  }

  @Post('rules')
  setQuotaRule(@Body() body: any) {
    return this.quota.setQuotaRule(body, body.actorId || 'SYSTEM');
  }

  @Get(':tenantId/usage')
  getUsageWithQuotas(@Param('tenantId') tenantId: string) {
    return this.quota.getUsageWithQuotas(tenantId);
  }

  @Post(':tenantId/alert')
  logUsageAlert(@Param('tenantId') tenantId: string, @Body() body: any) {
    return this.quota.logUsageAlert(tenantId, body.metric, body.currentValue, body.limitValue, body.actorId || 'SYSTEM');
  }
}
