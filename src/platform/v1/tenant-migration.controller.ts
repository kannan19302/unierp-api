import { Controller, Get, Post, Param, Body, UseGuards } from '@nestjs/common';
import { SaasTenantMigrationDeepService } from './tenant-migration.service';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RbacGuard } from '../../common/guards/rbac.guard';
import { ControlPlaneGuard } from '../../common/guards/control-plane.guard';
import { SkipTenantScope } from '../../common/decorators/skip-tenant-scope.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { TrackChanges } from '../../common/decorators/track-changes.decorator';

/**
 * Tenant migration and cluster movement (C22's backing surface).
 * M47 / D046: shipped with no authorization guard of any kind. Every route
 * here acts on a tenant named in the URL.
 */
@ApiTags('admin')
@ApiBearerAuth()
@Controller('platform/v1/migrations')
@SkipTenantScope()
@UseGuards(JwtAuthGuard, RbacGuard, ControlPlaneGuard)
export class SaasTenantMigrationDeepController {
  constructor(private readonly migration: SaasTenantMigrationDeepService) {}

  @Get(':tenantId/jobs')
  @Permissions('system.migration.read')
  getMigrationJobs(@Param('tenantId') tenantId: string) {
    return this.migration.getMigrationJobs(tenantId);
  }

  @Post(':tenantId/rehearse')
  @Permissions('system.migration.execute')
  rehearseMigration(@Param('tenantId') tenantId: string, @Body() body: any) {
    return this.migration.rehearseMigration({ tenantId, ...body });
  }

  @Post(':tenantId/start')
  @Permissions('system.migration.execute')
  @TrackChanges('Tenant')
  startMigration(@Param('tenantId') tenantId: string, @Body() body: any) {
    return this.migration.startMigration({ tenantId, ...body }, body.actorId || 'SYSTEM');
  }

  @Post('jobs/:jobId/complete')
  @Permissions('system.migration.execute')
  @TrackChanges('Tenant')
  completeMigration(@Param('jobId') jobId: string, @Body() body: { actorId: string }) {
    return this.migration.completeMigration(jobId, body.actorId || 'SYSTEM');
  }

  @Post('jobs/:jobId/rollback')
  @Permissions('system.migration.rollback')
  @TrackChanges('Tenant')
  rollbackMigration(@Param('jobId') jobId: string, @Body() body: { actorId: string }) {
    return this.migration.rollbackMigration(jobId, body.actorId || 'SYSTEM');
  }
}
