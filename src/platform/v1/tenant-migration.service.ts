import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { prisma } from '@kannan19302/database';
import { ControlPlaneAuditService } from './control-plane-audit.service';

/**
 * C22 - Tenant Migration
 * Provides pre-flight rehearsal, downtime estimation, cutover, rollback,
 * and data residency constraint enforcement (A26).
 */

const ALLOWED_CROSS_REGION: Record<string, string[]> = {
  'eu-west-1': ['eu-west-1', 'eu-central-1'],
  'us-east-1': ['us-east-1', 'us-west-2'],
  'ap-southeast-1': ['ap-southeast-1'],
};

interface MigrationJobRecord {
  id: string;
  tenantId: string;
  sourceCluster: string;
  targetCluster: string;
  targetRegion: string;
  stage: string;
  status: string;
  estimatedDowntimeSeconds: number;
  createdAt: Date;
  completedAt?: Date;
}

const migrationJobsStore: MigrationJobRecord[] = [];

@Injectable()
export class SaasTenantMigrationDeepService {
  private readonly logger = new Logger(SaasTenantMigrationDeepService.name);

  constructor(private readonly audit: ControlPlaneAuditService) {}

  async getMigrationJobs(tenantId: string) {
    return migrationJobsStore.filter((j) => j.tenantId === tenantId);
  }

  /**
   * Pre-flight rehearsal: estimates downtime and validates residency constraints.
   * A26: tenant's residencyRegion must be compatible with targetRegion.
   */
  async rehearseMigration(dto: {
    tenantId: string;
    targetCluster: string;
    targetRegion: string;
  }) {
    const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: dto.tenantId } });
    const sourceRegion = tenant.residencyRegion;

    const allowedTargets = ALLOWED_CROSS_REGION[sourceRegion] ?? [sourceRegion];
    if (!allowedTargets.includes(dto.targetRegion)) {
      throw new BadRequestException(
        `A26 Residency Violation: Cannot migrate tenant from ${sourceRegion} to ${dto.targetRegion}. Permitted targets: ${allowedTargets.join(', ')}`,
      );
    }

    const usageRecords = await prisma.usageRecord.findMany({ where: { tenantId: dto.tenantId } });
    const totalDataMb = usageRecords.reduce((sum, u) => (u.metric === 'STORAGE_MB' ? sum + u.currentValue : sum), 0);
    const estimatedDowntimeSeconds = 30 + Math.ceil(totalDataMb / 100);

    return {
      tenantId: dto.tenantId,
      sourceCluster: `${sourceRegion}-shared`,
      sourceRegion,
      targetCluster: dto.targetCluster,
      targetRegion: dto.targetRegion,
      estimatedDowntimeSeconds,
      totalDataMb,
      residencyCompliant: true,
      rehearsedAt: new Date(),
    };
  }

  async startMigration(dto: {
    tenantId: string;
    sourceCluster: string;
    targetCluster: string;
    targetRegion: string;
  }, actorId: string) {
    const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: dto.tenantId } });
    const sourceRegion = tenant.residencyRegion;

    const allowedTargets = ALLOWED_CROSS_REGION[sourceRegion] ?? [sourceRegion];
    if (!allowedTargets.includes(dto.targetRegion)) {
      throw new BadRequestException(`A26 Residency Violation: Migration to ${dto.targetRegion} not permitted`);
    }

    const rehearsal = await this.rehearseMigration(dto);

    const job: MigrationJobRecord = {
      id: `mig-${Date.now()}`,
      tenantId: dto.tenantId,
      sourceCluster: dto.sourceCluster || `${sourceRegion}-shared`,
      targetCluster: dto.targetCluster,
      targetRegion: dto.targetRegion,
      stage: 'CUTOVER',
      status: 'IN_PROGRESS',
      estimatedDowntimeSeconds: rehearsal.estimatedDowntimeSeconds,
      createdAt: new Date(),
    };
    migrationJobsStore.push(job);

    await prisma.$transaction(async (tx) => {
      await tx.tenant.update({
        where: { id: dto.tenantId },
        data: { status: 'MAINTENANCE' },
      });

      await tx.systemAnnouncement.create({
        data: {
          tenantId: dto.tenantId,
          title: 'Scheduled Maintenance: Infrastructure Migration',
          message: `Your account is being migrated to improved infrastructure. Estimated downtime: ${rehearsal.estimatedDowntimeSeconds}s.`,
          type: 'info',
          priority: 'high',
          createdBy: actorId,
        },
      });

      await this.audit.record(
        {
          actorId,
          actorRole: 'SUPER_ADMIN',
          action: 'migration.start',
          targetId: dto.tenantId,
          details: { jobId: job.id, dto, rehearsal },
        },
        tx as any,
      );
    });

    return job;
  }

  async completeMigration(jobId: string, actorId: string) {
    const job = migrationJobsStore.find((j) => j.id === jobId);
    if (!job) throw new BadRequestException('Migration job not found');

    job.status = 'COMPLETED';
    job.stage = 'DONE';
    job.completedAt = new Date();

    await prisma.$transaction(async (tx) => {
      await tx.tenant.update({
        where: { id: job.tenantId },
        data: {
          residencyRegion: job.targetRegion,
          status: 'ACTIVE',
        },
      });

      await this.audit.record(
        {
          actorId,
          actorRole: 'SUPER_ADMIN',
          action: 'migration.complete',
          targetId: job.tenantId,
          details: { jobId, targetCluster: job.targetCluster },
        },
        tx as any,
      );
    });

    return { jobId, status: 'COMPLETED' };
  }

  async rollbackMigration(jobId: string, actorId: string) {
    const job = migrationJobsStore.find((j) => j.id === jobId);
    if (!job) throw new BadRequestException('Migration job not found');

    if (job.status === 'COMPLETED') {
      throw new BadRequestException('Cannot rollback a completed migration');
    }

    job.status = 'ROLLED_BACK';
    job.stage = 'ROLLBACK';

    await prisma.$transaction(async (tx) => {
      await tx.tenant.update({
        where: { id: job.tenantId },
        data: { status: 'ACTIVE' },
      });

      await this.audit.record(
        {
          actorId,
          actorRole: 'SUPER_ADMIN',
          action: 'migration.rollback',
          targetId: job.tenantId,
          details: { jobId },
        },
        tx as any,
      );
    });

    return { jobId, status: 'ROLLED_BACK', message: 'Migration rolled back; tenant restored to source cluster.' };
  }
}
