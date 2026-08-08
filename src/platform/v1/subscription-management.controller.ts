import { Controller, Get, Post, Put, Body, Param, Req } from '@nestjs/common';
import { SubscriptionManagementService, SubscriptionTransitionDto } from './subscription-management.service';
import { Request } from 'express';

@Controller('platform/v1/subscriptions')
export class SubscriptionManagementController {
  constructor(private readonly subService: SubscriptionManagementService) {}

  @Get(':tenantId')
  async getSubscription(@Param('tenantId') tenantId: string) {
    return this.subService.getSubscription(tenantId);
  }

  @Post(':tenantId')
  async createSubscription(
    @Param('tenantId') tenantId: string,
    @Body() dto: SubscriptionTransitionDto,
    @Req() req: Request,
  ) {
    return this.subService.createSubscription(tenantId, dto, (req as any).user?.id || 'SUPER_ADMIN');
  }

  @Put(':tenantId/transition')
  async transitionSubscription(
    @Param('tenantId') tenantId: string,
    @Body() dto: SubscriptionTransitionDto,
    @Req() req: Request,
  ) {
    return this.subService.transitionSubscription(tenantId, dto, (req as any).user?.id || 'SUPER_ADMIN');
  }

  @Post(':tenantId/pause')
  async pauseSubscription(@Param('tenantId') tenantId: string, @Req() req: Request) {
    return this.subService.pauseSubscription(tenantId, (req as any).user?.id || 'SUPER_ADMIN');
  }

  @Post(':tenantId/resume')
  async winBackOrResume(@Param('tenantId') tenantId: string, @Req() req: Request) {
    return this.subService.winBackOrResume(tenantId, (req as any).user?.id || 'SUPER_ADMIN');
  }

  @Post(':tenantId/cancel')
  async cancelSubscription(@Param('tenantId') tenantId: string, @Req() req: Request) {
    return this.subService.cancelSubscription(tenantId, (req as any).user?.id || 'SUPER_ADMIN');
  }
}
