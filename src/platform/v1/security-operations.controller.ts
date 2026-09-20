import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  Req,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RbacGuard } from '../../common/guards/rbac.guard';
import { ControlPlaneGuard } from '../../common/guards/control-plane.guard';
import { TwoPersonControlGuard } from '../../common/guards/two-person-control.guard';
import { SkipTenantScope } from '../../common/decorators/skip-tenant-scope.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { TwoPersonControl } from '../../common/decorators/two-person-control.decorator';
import { SecurityOperationsService } from './security-operations.service';
import type {
  CreateSecurityPolicyDto,
  UpdateSecurityPolicyDto,
  ThreatTriageDto,
} from './dto/security-crud.dto';

/**
 * Security operations centre (C28's backing surface).
 * Covers tenant quarantine, session revocation, breach response,
 * security policy management, and live threat triage.
 */
@ApiTags('admin')
@ApiBearerAuth()
@Controller('platform/v1/soc')
@SkipTenantScope()
@UseGuards(JwtAuthGuard, RbacGuard, ControlPlaneGuard, TwoPersonControlGuard)
export class SecurityOperationsController {
  constructor(private readonly soc: SecurityOperationsService) {}

  // ─── SOC Remediation Actions ──────────────────────────────────────────────

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

  // ─── Security Policies CRUD ───────────────────────────────────────────────

  @ApiOperation({ summary: 'List security isolation policies' })
  @Get('policies')
  @Permissions('system.soc.read', 'system.isolation.read', 'pcc.security.view')
  listPolicies(
    @Query('page') page?: number,
    @Query('pageSize') pageSize?: number,
    @Query('search') search?: string,
    @Query('scopeType') scopeType?: string,
  ) {
    return this.soc.listPolicies({ page, pageSize, search, scopeType });
  }

  @ApiOperation({ summary: 'Get policy details' })
  @Get('policies/:id')
  @Permissions('system.soc.read', 'system.isolation.read', 'pcc.security.view')
  getPolicy(@Param('id') id: string) {
    return this.soc.getPolicy(id);
  }

  @ApiOperation({ summary: 'Create new security isolation policy' })
  @Post('policies')
  @Permissions('system.soc.execute', 'system.isolation.write')
  createPolicy(@Body() body: CreateSecurityPolicyDto, @Req() req: any) {
    const actorId = req.user?.userId || req.user?.sub || 'SYSTEM';
    return this.soc.createPolicy(body, actorId);
  }

  @ApiOperation({ summary: 'Update security isolation policy' })
  @Patch('policies/:id')
  @Permissions('system.soc.execute', 'system.isolation.write')
  updatePolicy(
    @Param('id') id: string,
    @Body() body: UpdateSecurityPolicyDto,
    @Req() req: any,
  ) {
    const actorId = req.user?.userId || req.user?.sub || 'SYSTEM';
    return this.soc.updatePolicy(id, body, actorId);
  }

  @ApiOperation({ summary: 'Delete security isolation policy' })
  @Delete('policies/:id')
  @Permissions('system.soc.execute', 'system.isolation.write')
  deletePolicy(@Param('id') id: string, @Req() req: any) {
    const actorId = req.user?.userId || req.user?.sub || 'SYSTEM';
    return this.soc.deletePolicy(id, actorId);
  }

  // ─── Live Threat Triage Workflow ──────────────────────────────────────────

  @ApiOperation({ summary: 'List live security threats and anomalies' })
  @Get('threats')
  @Permissions('system.soc.read', 'pcc.security.view')
  listThreats(
    @Query('severity') severity?: string,
    @Query('status') status?: string,
    @Query('search') search?: string,
  ) {
    return this.soc.listThreats({ severity, status, search });
  }

  @ApiOperation({ summary: 'Triage threat event (acknowledge, investigate, resolve, close)' })
  @Patch('threats/:id/triage')
  @Permissions('system.soc.execute')
  triageThreat(
    @Param('id') id: string,
    @Body() body: ThreatTriageDto,
    @Req() req: any,
  ) {
    const actorId = req.user?.userId || req.user?.sub || 'SYSTEM';
    return this.soc.triageThreat(id, body, actorId);
  }
}
