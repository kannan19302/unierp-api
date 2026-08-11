import { Controller, Get, Post, Param, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RbacGuard } from '../../common/guards/rbac.guard';
import { ControlPlaneGuard } from '../../common/guards/control-plane.guard';
import { SkipTenantScope } from '../../common/decorators/skip-tenant-scope.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { DunningService, DunningStep } from './dunning.service';

/**
 * Dunning and collections (C17's backing surface).
 * M47 / D046: shipped with no guard. It imported `UseGuards` and never used it,
 * which is a fair summary of how this class of defect happens.
 */
@ApiTags('admin')
@ApiBearerAuth()
@Controller('platform/v1/dunning')
@SkipTenantScope()
@UseGuards(JwtAuthGuard, RbacGuard, ControlPlaneGuard)
export class DunningController {
  constructor(private readonly dunning: DunningService) {}

  @Get('status/:tenantId')
  @Permissions('system.dunning.read')
  getDunningStatus(@Param('tenantId') tenantId: string) {
    return this.dunning.getDunningStatus(tenantId);
  }

  @Post(':tenantId/execute')
  @Permissions('system.dunning.execute')
  executeDunningStep(
    @Param('tenantId') tenantId: string,
    @Body() body: { step: DunningStep; actorId: string },
  ) {
    return this.dunning.executeDunningStep(tenantId, body.step, body.actorId || 'SYSTEM');
  }

  @Post(':tenantId/recover')
  @Permissions('system.dunning.execute')
  recoverFromDunning(@Param('tenantId') tenantId: string, @Body() body: { actorId: string }) {
    return this.dunning.recoverFromDunning(tenantId, body.actorId || 'SYSTEM');
  }
}
