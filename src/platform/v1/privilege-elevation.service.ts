/**
 * M32 — just-in-time privilege elevation with a hard expiry, audited on
 * BOTH grant and expiry. Expiry is discovered lazily (checked whenever
 * `isElevated()` or `expireDue()` runs), not by a background timer —
 * consistent with how every other time-bound check in this platform
 * (M03's credential expiry, M23's certificate rotation) already works —
 * but the expiry audit fires exactly ONCE per grant, via
 * `expiredAuditedAt`, not on every subsequent check that finds it
 * already expired.
 */
import { Injectable } from "@nestjs/common";
import { prisma } from "@kannan19302/database";
import { ControlPlaneAuditService } from "./control-plane-audit.service";

@Injectable()
export class PrivilegeElevationService {
  constructor(private readonly audit: ControlPlaneAuditService) {}

  async grant(userId: string, privilege: string, grantedBy: string, ttlMs: number) {
    const elevation = await (prisma as any).privilegeElevation.create({
      data: { userId, privilege, grantedBy, expiresAt: new Date(Date.now() + ttlMs) },
    });

    await this.audit.record({
      actorId: grantedBy,
      actorRole: "provider",
      action: "privilege.elevation-granted",
      targetId: userId,
      details: { privilege, elevationId: elevation.id, expiresAt: elevation.expiresAt },
    });

    return elevation;
  }

  /**
   * Checks whether a grant is currently active. If it has passed
   * `expiresAt` and has never been expiry-audited, records the expiry
   * audit right here, at discovery time — the ONE place expiry is ever
   * detected — then returns false.
   */
  async isElevated(userId: string, privilege: string, now: Date = new Date()): Promise<boolean> {
    const elevation = await (prisma as any).privilegeElevation.findFirst({
      where: { userId, privilege },
      orderBy: { grantedAt: "desc" },
    });
    if (!elevation) return false;

    if (elevation.expiresAt < now) {
      if (!elevation.expiredAuditedAt) {
        await (prisma as any).privilegeElevation.update({
          where: { id: elevation.id },
          data: { expiredAuditedAt: now },
        });
        await this.audit.record({
          actorId: "system:privilege-elevation",
          actorRole: "system",
          action: "privilege.elevation-expired",
          targetId: userId,
          details: { privilege, elevationId: elevation.id, grantedAt: elevation.grantedAt, expiresAt: elevation.expiresAt },
        });
      }
      return false;
    }

    return true;
  }
}
