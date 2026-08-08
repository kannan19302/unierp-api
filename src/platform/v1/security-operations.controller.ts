import { Controller, Post, Param, Body } from '@nestjs/common';
import { SecurityOperationsService } from './security-operations.service';

@Controller('platform/v1/soc')
export class SecurityOperationsController {
  constructor(private readonly soc: SecurityOperationsService) {}

  @Post(':tenantId/revoke-sessions')
  revokeTenantSessions(
    @Param('tenantId') tenantId: string,
    @Body() body: { reason: string; actorId?: string },
  ) {
    return this.soc.revokeTenantSessions(tenantId, body.reason, body.actorId || 'SYSTEM');
  }

  @Post(':tenantId/quarantine')
  quarantineTenant(
    @Param('tenantId') tenantId: string,
    @Body() body: { reason: string; actorId?: string },
  ) {
    return this.soc.quarantineTenant(tenantId, body.reason, body.actorId || 'SYSTEM');
  }

  @Post('breach-response')
  executeBreachResponse(@Body() body: any) {
    return this.soc.executeBreachResponse(body, body.actorId || 'SYSTEM');
  }
}
