import { Controller, Get, Post, Param, Body } from '@nestjs/common';
import { SaasTenantMigrationDeepService } from './tenant-migration.service';

@Controller('platform/v1/migrations')
export class SaasTenantMigrationDeepController {
  constructor(private readonly migration: SaasTenantMigrationDeepService) {}

  @Get(':tenantId/jobs')
  getMigrationJobs(@Param('tenantId') tenantId: string) {
    return this.migration.getMigrationJobs(tenantId);
  }

  @Post(':tenantId/rehearse')
  rehearseMigration(@Param('tenantId') tenantId: string, @Body() body: any) {
    return this.migration.rehearseMigration({ tenantId, ...body });
  }

  @Post(':tenantId/start')
  startMigration(@Param('tenantId') tenantId: string, @Body() body: any) {
    return this.migration.startMigration({ tenantId, ...body }, body.actorId || 'SYSTEM');
  }

  @Post('jobs/:jobId/complete')
  completeMigration(@Param('jobId') jobId: string, @Body() body: { actorId: string }) {
    return this.migration.completeMigration(jobId, body.actorId || 'SYSTEM');
  }

  @Post('jobs/:jobId/rollback')
  rollbackMigration(@Param('jobId') jobId: string, @Body() body: { actorId: string }) {
    return this.migration.rollbackMigration(jobId, body.actorId || 'SYSTEM');
  }
}
