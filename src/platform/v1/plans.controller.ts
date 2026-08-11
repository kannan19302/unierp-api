import { Controller, Get, Post, Put, Body, Param, Query, UseGuards, Req, NotFoundException } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RbacGuard } from '../../common/guards/rbac.guard';
import { ControlPlaneGuard } from '../../common/guards/control-plane.guard';
import { SkipTenantScope } from '../../common/decorators/skip-tenant-scope.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { PlansService, CreatePlanDto, UpdatePlanDto, PriceDto } from './plans.service';
import { Request } from 'express';

/**
 * Plans, packaging and price books (C13's backing surface).
 * M47 / D046: shipped with no guard. Plan and price definitions are the single
 * source the runtime enforces entitlements from, so an unguarded write here
 * changes what every tenant is entitled to and billed for.
 */
@ApiTags('admin')
@ApiBearerAuth()
@Controller('platform/v1/plans')
@SkipTenantScope()
@UseGuards(JwtAuthGuard, RbacGuard, ControlPlaneGuard)
export class PlansController {
  constructor(private readonly plansService: PlansService) {}

  @Get()
  @Permissions('system.plan.read')
  async listPlans(@Query('includeArchived') includeArchived?: string) {
    return this.plansService.listPlans(includeArchived === 'true');
  }

  @Get(':id')
  @Permissions('system.plan.read')
  async getPlan(@Param('id') id: string) {
    try {
      return await this.plansService.getPlan(id);
    } catch (e) {
      throw new NotFoundException(`Plan ${id} not found`);
    }
  }

  @Post()
  @Permissions('system.plan.write')
  async createPlan(
    @Body() dto: CreatePlanDto,
    @Req() req: Request,
  ) {
    return this.plansService.createPlan(dto, (req as any).user?.id || 'SUPER_ADMIN');
  }

  @Put(':id')
  @Permissions('system.plan.write')
  async updatePlan(
    @Param('id') id: string,
    @Body() body: { data: UpdatePlanDto; reason: string },
    @Req() req: Request,
  ) {
    try {
      return await this.plansService.updatePlan(
        id,
        body.data,
        (req as any).user?.id || 'SUPER_ADMIN',
        body.reason,
      );
    } catch (e) {
      throw new NotFoundException(`Plan ${id} not found`);
    }
  }

  @Post(':id/prices')
  @Permissions('system.plan.write')
  async setPlanPrices(
    @Param('id') id: string,
    @Body() body: { prices: PriceDto[]; reason: string },
    @Req() req: Request,
  ) {
    try {
      return await this.plansService.setPlanPrices(
        id,
        body.prices,
        (req as any).user?.id || 'SUPER_ADMIN',
        body.reason,
      );
    } catch (e) {
      throw new NotFoundException(`Plan ${id} not found`);
    }
  }
}
