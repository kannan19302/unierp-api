import { Controller, Get, Post, Put, Body, Param, Query, UseGuards, Req, NotFoundException } from '@nestjs/common';
import { PlansService, CreatePlanDto, UpdatePlanDto, PriceDto } from './plans.service';
import { Request } from 'express';

@Controller('platform/v1/plans')
export class PlansController {
  constructor(private readonly plansService: PlansService) {}

  @Get()
  async listPlans(@Query('includeArchived') includeArchived?: string) {
    return this.plansService.listPlans(includeArchived === 'true');
  }

  @Get(':id')
  async getPlan(@Param('id') id: string) {
    try {
      return await this.plansService.getPlan(id);
    } catch (e) {
      throw new NotFoundException(`Plan ${id} not found`);
    }
  }

  @Post()
  async createPlan(
    @Body() dto: CreatePlanDto,
    @Req() req: Request,
  ) {
    return this.plansService.createPlan(dto, (req as any).user?.id || 'SUPER_ADMIN');
  }

  @Put(':id')
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
