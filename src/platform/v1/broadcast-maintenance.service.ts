import { Injectable, Logger } from '@nestjs/common';
import { prisma } from '@kannan19302/database';
import { ControlPlaneAuditService } from './control-plane-audit.service';

/**
 * C21 - Broadcast & Maintenance
 * Schedules maintenance windows targeting specific clusters or tenants,
 * and updates the public status page in a single atomic action.
 */
@Injectable()
export class BroadcastMaintenanceService {
  private readonly logger = new Logger(BroadcastMaintenanceService.name);

  constructor(private readonly audit: ControlPlaneAuditService) {}

  async listMaintenanceWindows() {
    return prisma.saasMaintenanceWindow.findMany({
      orderBy: { scheduledStart: 'desc' },
    });
  }

  async scheduleMaintenanceWindow(
    dto: {
      title: string;
      message: string;
      targetClusters: string[];
      targetTenants: string[];
      startTime: Date;
      endTime: Date;
    },
    actorId: string,
  ) {
    return prisma.$transaction(async (tx) => {
      const window = await tx.saasMaintenanceWindow.create({
        data: {
          tenantId: dto.targetTenants[0] || 'GLOBAL',
          title: dto.title,
          description: dto.message,
          scheduledStart: dto.startTime,
          scheduledEnd: dto.endTime,
          status: 'SCHEDULED',
          createdBy: actorId,
        },
      });

      if (dto.targetTenants.length > 0) {
        await tx.systemAnnouncement.createMany({
          data: dto.targetTenants.map((tenantId) => ({
            tenantId,
            title: `Scheduled Maintenance: ${dto.title}`,
            message: `${dto.message}\n\nStart: ${dto.startTime.toISOString()}\nEnd: ${dto.endTime.toISOString()}`,
            type: 'info',
            priority: 'high',
            createdBy: actorId,
          })),
        });
      }

      await this.audit.record(
        {
          actorId,
          actorRole: 'SUPER_ADMIN',
          action: 'broadcast.maintenance.schedule',
          targetId: window.id,
          details: dto,
        },
        tx as any,
      );

      return window;
    });
  }

  async cancelMaintenanceWindow(windowId: string, actorId: string) {
    return prisma.$transaction(async (tx) => {
      const window = await tx.saasMaintenanceWindow.update({
        where: { id: windowId },
        data: { status: 'CANCELLED' },
      });

      await this.audit.record(
        {
          actorId,
          actorRole: 'SUPER_ADMIN',
          action: 'broadcast.maintenance.cancel',
          targetId: windowId,
          details: { cancelledAt: new Date() },
        },
        tx as any,
      );

      return window;
    });
  }

  async broadcastSystemMessage(
    dto: { title: string; message: string; tenantIds: string[]; priority?: string },
    actorId: string,
  ) {
    const announcements = await prisma.systemAnnouncement.createMany({
      data: dto.tenantIds.map((tenantId) => ({
        tenantId,
        title: dto.title,
        message: dto.message,
        type: 'info',
        priority: dto.priority ?? 'normal',
        createdBy: actorId,
      })),
    });

    await this.audit.record({
      actorId,
      actorRole: 'SUPER_ADMIN',
      action: 'broadcast.message.send',
      targetId: 'platform',
      details: { tenantCount: dto.tenantIds.length, dto },
    });

    return { broadcasted: announcements.count, tenantIds: dto.tenantIds };
  }
}
