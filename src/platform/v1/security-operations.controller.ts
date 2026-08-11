import { Controller, Post, Param, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RbacGuard } from '../../common/guards/rbac.guard';
import { ControlPlaneGuard } from '../../common/guards/control-plane.guard';
import { TwoPersonControlGuard } from '../../common/guards/two-person-control.guard';
import { SkipTenantScope } from '../../common/decorators/skip-tenant-scope.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { TwoPersonControl } from '../../common/decorators/two-person-control.decorator';
import { SecurityOperationsService } from './security-operations.service';

/**
 * Security operations centre (C28's backing surface).
 *
 * M47 / D046: shipped unguarded. Every route here acts on a tenant named in the
 * URL — revoking its sessions, quarantining it, or running breach response —
 * and none of them checked who was asking.
 */
@ApiTags('admin')
@ApiBearerAuth()
@Controller('platform/v1/soc')
@SkipTenantScope()
@UseGuards(JwtAuthGuard, RbacGuard, ControlPlaneGuard, TwoPersonControlGuard)
export class SecurityOperationsController {
  constructor(private readonly soc: SecurityOperationsService) {}

  @Post(':tenantId/revoke-sessions')
  @Permissions('system.soc.execute')
  revokeTenantSessions(
    @Param('tenantId') tenantId: string,
    @Body() body: { reason: string; actorId?: string },
  ) {
    return this.soc.revokeTenantSessions(tenantId, body.reason, body.actorId || 'SYSTEM');
  }

  // Quarantine cuts a tenant off from the platform. Destructive and
  // cross-tenant, so it carries two-person control per Track C's invariant.
  @Post(':tenantId/quarantine')
  @Permissions('system.soc.execute')
  @TwoPersonControl()
  quarantineTenant(
    @Param('tenantId') tenantId: string,
    @Body() body: { reason: string; actorId?: string },
  ) {
    return this.soc.quarantineTenant(tenantId, body.reason, body.actorId || 'SYSTEM');
  }

  @Post('breach-response')
  @Permissions('system.soc.execute')
  @TwoPersonControl()
  executeBreachResponse(@Body() body: any) {
    return this.soc.executeBreachResponse(body, body.actorId || 'SYSTEM');
  }
}
