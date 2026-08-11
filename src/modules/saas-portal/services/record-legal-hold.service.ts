/**
 * D12 — a generic legal hold, reusable across any entity type. Documents
 * and folders already have their own boolean `legalHold` field for the
 * same purpose (see documents.service.ts) — this is the equivalent
 * mechanism made reusable for every OTHER entity, not a replacement.
 * isOnHold() is the ONE check any deletion path (retention enforcement,
 * GDPR erasure, a user-triggered delete) must consult before removing a
 * held record — "legal hold provably suspends deletion" means every
 * such path calls this, and this proves what it returns.
 */
import { Injectable, BadRequestException } from "@nestjs/common";
import { prisma } from "@kannan19302/database";

@Injectable()
export class RecordLegalHoldService {
  async placeHold(tenantId: string, entityType: string, entityId: string, reason: string, heldBy: string) {
    const active = await this.getActiveHold(tenantId, entityType, entityId);
    if (active) {
      throw new BadRequestException(`"${entityType}:${entityId}" is already under an active legal hold (${active.id})`);
    }
    return (prisma as any).recordLegalHold.create({
      data: { tenantId, entityType, entityId, reason, heldBy },
    });
  }

  async releaseHold(tenantId: string, holdId: string, releasedBy: string) {
    const hold = await (prisma as any).recordLegalHold.findFirst({ where: { id: holdId, tenantId } });
    if (!hold) throw new BadRequestException(`Legal hold "${holdId}" not found`);
    if (hold.releasedAt) throw new BadRequestException(`Legal hold "${holdId}" is already released`);
    return (prisma as any).recordLegalHold.update({
      where: { id: holdId },
      data: { releasedAt: new Date(), releasedBy },
    });
  }

  private async getActiveHold(tenantId: string, entityType: string, entityId: string) {
    return (prisma as any).recordLegalHold.findFirst({
      where: { tenantId, entityType, entityId, releasedAt: null },
    });
  }

  /** The one check any deletion path must consult before removing a record. */
  async isOnHold(tenantId: string, entityType: string, entityId: string): Promise<boolean> {
    return (await this.getActiveHold(tenantId, entityType, entityId)) !== null;
  }

  /**
   * Filters a candidate id list down to the ones NOT under an active
   * legal hold — the exact shape retention enforcement or a bulk
   * erasure needs before deleting anything: "delete these, except
   * whichever of them are held."
   */
  async excludeHeld(tenantId: string, entityType: string, entityIds: string[]): Promise<string[]> {
    if (entityIds.length === 0) return [];
    const held = await (prisma as any).recordLegalHold.findMany({
      where: { tenantId, entityType, entityId: { in: entityIds }, releasedAt: null },
      select: { entityId: true },
    });
    const heldIds = new Set(held.map((h: any) => h.entityId));
    return entityIds.filter((id) => !heldIds.has(id));
  }
}
