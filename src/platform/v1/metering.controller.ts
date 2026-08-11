import { Controller, Get, Post, Body, Param, Req, UseGuards } from '@nestjs/common';
import { MeteringService, RecordEventDto } from './metering.service';
import { ProviderMeteringReconciliationService } from './provider-metering-reconciliation.service';
import { Request } from 'express';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RbacGuard } from '../../common/guards/rbac.guard';
import { ControlPlaneGuard } from '../../common/guards/control-plane.guard';
import { SkipTenantScope } from '../../common/decorators/skip-tenant-scope.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';

/**
 * Metering and usage (C14's backing surface).
 * M47 / D046: shipped with no authorization guard of any kind. Every route
 * here acts on a tenant named in the URL.
 */
@ApiTags('admin')
@ApiBearerAuth()
@Controller('platform/v1/metering')
@SkipTenantScope()
@UseGuards(JwtAuthGuard, RbacGuard, ControlPlaneGuard)
export class MeteringController {
  constructor(
    private readonly meteringService: MeteringService,
    private readonly providerReconciliation: ProviderMeteringReconciliationService,
  ) {}

  @Get(':tenantId/usage')
  @Permissions('system.metering.read')
  async getUsage(@Param('tenantId') tenantId: string) {
    return this.meteringService.getUsage(tenantId);
  }

  @Get(':tenantId/events/:metric')
  @Permissions('system.metering.read')
  async getEvents(
    @Param('tenantId') tenantId: string,
    @Param('metric') metric: string,
  ) {
    return this.meteringService.getEvents(tenantId, metric);
  }

  @Post(':tenantId/events')
  @Permissions('system.metering.write')
  async recordEvent(
    @Param('tenantId') tenantId: string,
    @Body() dto: RecordEventDto,
    @Req() req: Request,
  ) {
    return this.meteringService.recordEvent(tenantId, dto, (req as any).user?.id || 'SUPER_ADMIN');
  }

  @Post(':tenantId/reconcile/:metric')
  @Permissions('system.metering.write')
  async reconcile(
    @Param('tenantId') tenantId: string,
    @Param('metric') metric: string,
    @Req() req: Request,
  ) {
    return this.meteringService.reconcile(tenantId, metric, (req as any).user?.id || 'SUPER_ADMIN');
  }

  /** M30 — records a provider's OWN reported consumption, distinct from
   *  anything recorded via `recordEvent` above. */
  @Post(':tenantId/provider-consumption/:providerId/:metric/:period')
  @Permissions('system.metering.write')
  async recordProviderConsumption(
    @Param('tenantId') tenantId: string,
    @Param('providerId') providerId: string,
    @Param('metric') metric: string,
    @Param('period') period: string,
    @Body() body: { reportedQuantity: number },
  ) {
    return this.providerReconciliation.recordProviderConsumption(providerId, tenantId, metric, period, body.reportedQuantity);
  }

  /** M30 — extends this same reconciliation view with provider-vs-metered
   *  variance, alongside C14's own event-vs-snapshot reconcile() above. */
  @Get(':tenantId/provider-reconcile/:providerId/:metric/:period')
  @Permissions('system.metering.read')
  async reconcileAgainstProvider(
    @Param('tenantId') tenantId: string,
    @Param('providerId') providerId: string,
    @Param('metric') metric: string,
    @Param('period') period: string,
  ) {
    return this.providerReconciliation.reconcile(providerId, tenantId, metric, period);
  }
}
