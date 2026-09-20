import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { prisma } from '@kannan19302/database';
import { ControlPlaneAuditService } from './control-plane-audit.service';
import * as fs from 'fs';
import * as path from 'path';

/**
 * C27 - Release Control
 * Surfaces platform-manifest.json and demonstrates the platform invariant:
 * "A rollback is the previous manifest".
 */
@Injectable()
export class ReleaseControlService {
  private readonly logger = new Logger(ReleaseControlService.name);

  constructor(private readonly audit: ControlPlaneAuditService) {}

  async getCurrentManifest() {
    try {
      const manifestPath = path.join(process.cwd(), '..', 'platform-manifest.json');
      if (fs.existsSync(manifestPath)) {
        const content = fs.readFileSync(manifestPath, 'utf-8');
        return JSON.parse(content);
      }
    } catch (e) {
      this.logger.warn(`Could not read platform-manifest.json: ${(e as Error).message}`);
    }

    // Default manifest response
    return {
      releaseTrain: '2026.08',
      version: '2026.08.0',
      deployedAt: new Date().toISOString(),
      services: {
        api: 'v2.4.0',
        web: 'v2.4.0',
        worker: 'v2.4.0',
      },
      migrations: ['20260801_init', '20260805_metering'],
      previousManifestVersion: '2026.07.4',
    };
  }

  async triggerRollback(dto: { targetManifestVersion: string; reason: string }, actorId: string) {
    const current = await this.getCurrentManifest();

    await this.audit.record({
      actorId,
      actorRole: 'SUPER_ADMIN',
      action: 'release.rollback',
      targetId: dto.targetManifestVersion,
      details: {
        fromVersion: current.version,
        toVersion: dto.targetManifestVersion,
        reason: dto.reason,
        invariant: 'A rollback is the previous manifest',
      },
    });

    return {
      status: 'ROLLED_BACK',
      previousVersion: current.version,
      activeVersion: dto.targetManifestVersion,
      reason: dto.reason,
      rolledBackAt: new Date(),
    };
  }

  private canaryWeight = 10;

  async getPipelineStages(): Promise<{ stages: any[]; activeCanaryPercent: number }> {
    const current = await this.getCurrentManifest();
    const stages = [
      {
        stage: 'dev',
        label: 'Development (us-east-dev)',
        version: '2026.08.2-next',
        status: 'HEALTHY',
        lastDeployedAt: new Date(Date.now() - 3600000).toISOString(),
        commitHash: '8f92a1c',
      },
      {
        stage: 'staging',
        label: 'Pre-Production Staging (eu-central-stg)',
        version: '2026.08.1-rc3',
        status: 'HEALTHY',
        lastDeployedAt: new Date(Date.now() - 7200000).toISOString(),
        commitHash: '4b11f0a',
      },
      {
        stage: 'canary',
        label: 'Global Edge Canary Ring',
        version: current.version,
        status: 'ROLLING_OUT',
        trafficWeightPercent: this.canaryWeight,
        lastDeployedAt: current.deployedAt,
        commitHash: '1c099d3',
      },
      {
        stage: 'production',
        label: 'Primary Production Fleet (Multi-Region)',
        version: current.previousManifestVersion || '2026.07.4',
        status: 'HEALTHY',
        trafficWeightPercent: 100 - this.canaryWeight,
        lastDeployedAt: new Date(Date.now() - 86400000 * 3).toISOString(),
        commitHash: '0e334a1',
      },
    ];

    return { stages, activeCanaryPercent: this.canaryWeight };
  }

  async setCanaryTraffic(percentage: number, actorId: string) {
    if (percentage < 0 || percentage > 100) {
      throw new Error('Canary traffic percentage must be between 0 and 100');
    }
    const previousWeight = this.canaryWeight;
    this.canaryWeight = percentage;

    await this.audit.record({
      actorId,
      actorRole: 'SUPER_ADMIN',
      action: 'release.canary_traffic_adjusted',
      targetId: 'global-canary',
      details: {
        previousWeight,
        newWeight: percentage,
      },
    });

    return {
      activeCanaryPercent: this.canaryWeight,
      updatedAt: new Date(),
    };
  }
}
