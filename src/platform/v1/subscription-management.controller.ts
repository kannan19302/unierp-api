import { Controller, Get, Post, Put, Body, Param, Req, UseGuards } from '@nestjs/common';
import { SubscriptionManagementService, SubscriptionTransitionDto } from './subscription-management.service';
import { Request } from 'express';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RbacGuard } from '../../common/guards/rbac.guard';
import { ControlPlaneGuard } from '../../common/guards/control-plane.guard';
import { SkipTenantScope } from '../../common/decorators/skip-tenant-scope.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';

/**
 * Subscription management (C15's backing surface).
 * M47 / D046: shipped with no authorization guard of any kind. Every route
 * here acts on a tenant named in the URL.
 */
@ApiTags('admin')
@ApiBearerAuth()
@Controller('platform/v1/subscriptions')
@SkipTenantScope()
@UseGuards(JwtAuthGuard, RbacGuard, ControlPlaneGuard)
export class SubscriptionManagementController {
  constructor(private readonly subService: SubscriptionManagementService) {}

  @Get(':tenantId')
  @Permissions('system.subscription.read')
  async getSubscription(@Param('tenantId') tenantId: string) {
    return this.subService.getSubscription(tenantId);
  }

  @Post(':tenantId')
  @Permissions('system.subscription.write')
  async createSubscription(
    @Param('tenantId') tenantId: string,
    @Body() dto: SubscriptionTransitionDto,
    @Req() req: Request,
  ) {
    return this.subService.createSubscription(tenantId, dto, (req as any).user?.id || 'SUPER_ADMIN');
  }

  @Put(':tenantId/transition')
  @Permissions('system.subscription.write')
  async transitionSubscription(
    @Param('tenantId') tenantId: string,
    @Body() dto: SubscriptionTransitionDto,
    @Req() req: Request,
  ) {
    return this.subService.transitionSubscription(tenantId, dto, (req as any).user?.id || 'SUPER_ADMIN');
  }

  @Post(':tenantId/pause')
  @Permissions('system.subscription.write')
  async pauseSubscription(@Param('tenantId') tenantId: string, @Req() req: Request) {
    return this.subService.pauseSubscription(tenantId, (req as any).user?.id || 'SUPER_ADMIN');
  }

  @Post(':tenantId/resume')
  @Permissions('system.subscription.write')
  async winBackOrResume(@Param('tenantId') tenantId: string, @Req() req: Request) {
    return this.subService.winBackOrResume(tenantId, (req as any).user?.id || 'SUPER_ADMIN');
  }

  @Post(':tenantId/cancel')
  @Permissions('system.subscription.write')
  async cancelSubscription(@Param('tenantId') tenantId: string, @Req() req: Request) {
    return this.subService.cancelSubscription(tenantId, (req as any).user?.id || 'SUPER_ADMIN');
  }
}
