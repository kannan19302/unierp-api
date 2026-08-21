import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { prisma, idpPrisma, runWithTenantSession } from "@kannan19302/database";
import { signSessionToken } from "@kannan19302/auth";

const MAX_SESSION_HOURS = 1;

/**
 * Shape returned by `support_list_active_impersonations()` (snake_case, as
 * Postgres returns it) — see the W9 migration for why the estate-wide read
 * goes through a SECURITY DEFINER function rather than a normal query.
 */
interface ActiveImpersonationRow {
  id: string;
  tenant_id: string;
  impersonator_id: string;
  target_user_id: string;
  consent_id: string;
  status: string;
  expires_at: Date;
  created_at: Date;
}

/**
 * The provider-side half of the support-access flow the plan requires:
 * "tenant must consent, time-boxed, `platform.support.l2` only ... every
 * action audited with both identities."
 *
 * The tenant-side half already existed — `PlatformService.grantSupportConsent`
 * writes a `TenantConsent` row, and `ImpersonationSession` was defined in the
 * schema — but nothing on the provider side ever consumed a consent to
 * actually START a session. A tenant admin could grant consent into a void.
 * This closes that gap without touching either existing model.
 *
 * Session length is capped at one hour even if the tenant granted a longer
 * consent window, and is further capped at whatever remains of the consent
 * itself — a consent about to expire cannot be used to mint a fresh hour.
 */
@Injectable()
export class SupportImpersonationService {
  async start(
    tenantId: string,
    targetUserId: string,
    impersonatorId: string,
    impersonatorEmail: string,
  ) {
    // tenant_consents and impersonation_sessions both carry FORCE row-level
    // security keyed on current_tenant_id() (W9 migration), so every read and
    // write below has to run inside an explicit tenant session. Without it the
    // consent lookup returns zero rows — indistinguishable from "no consent
    // granted" — and the insert fails the policy's WITH CHECK outright.
    const consent = await runWithTenantSession(
      { tenantId, userId: impersonatorId },
      () =>
        (prisma as any).tenantConsent.findFirst({
          where: { tenantId, status: "ACTIVE", expiresAt: { gt: new Date() } },
          orderBy: { createdAt: "desc" },
        }),
    );
    if (!consent) {
      throw new ForbiddenException(
        "This tenant has not granted an active support-access consent.",
      );
    }

    // Scoped like the consent read above — `users` is RLS ENABLE + FORCE, so
    // an unscoped lookup returns null and this reports "Target user not found
    // in this tenant" for a user that is present and active.
    const targetUser = await runWithTenantSession(
      { tenantId, userId: impersonatorId },
      () =>
        idpPrisma.user.findFirst({
          where: { id: targetUserId, tenantId },
          include: { roles: { include: { role: true } } },
        }),
    );
    if (!targetUser) {
      throw new NotFoundException("Target user not found in this tenant");
    }

    const now = Date.now();
    const capByDuration = now + MAX_SESSION_HOURS * 60 * 60 * 1000;
    const capByConsent = new Date(consent.expiresAt).getTime();
    const expiresAt = new Date(Math.min(capByDuration, capByConsent));

    const session = await runWithTenantSession(
      { tenantId, userId: impersonatorId },
      () =>
        (prisma as any).impersonationSession.create({
          data: {
            tenantId,
            impersonatorId,
            targetUserId,
            consentId: consent.id,
            status: "ACTIVE",
            expiresAt,
          },
        }),
    );

    const roles = targetUser.roles.map((r: any) => r.role.name);
    const token = signSessionToken(
      {
        sid: `impersonation:${session.id}`,
        userId: targetUser.id,
        tenantId,
        realm: "tenant",
        amr: ["impersonation"],
        mfaVerified: true,
        impersonatedBy: impersonatorId,
        impersonatedByEmail: impersonatorEmail,
        impersonationSessionId: session.id,
      } as any,
      `${MAX_SESSION_HOURS}h`,
    );

    // audit_logs is RLS ENABLE + FORCE — unscoped this insert is silently
    // rejected, and the one record proving who impersonated whom never exists.
    await runWithTenantSession({ tenantId, userId: impersonatorId }, () =>
      prisma.auditLog.create({
      data: {
        tenantId,
        userId: impersonatorId,
        action: "SUPPORT_IMPERSONATION_START",
        entityType: "ImpersonationSession",
        entityId: session.id,
        changes: {
          impersonatorId,
          impersonatorEmail,
          targetUserId,
          targetUserEmail: targetUser.email,
          consentId: consent.id,
          expiresAt: expiresAt.toISOString(),
        },
      },
      }),
    );

    return {
      token,
      session,
      targetUser: {
        id: targetUser.id,
        email: targetUser.email,
        firstName: targetUser.firstName,
        lastName: targetUser.lastName,
        roles,
      },
    };
  }

  async stop(sessionId: string, impersonatorId: string, impersonatorEmail: string) {
    // Chicken-and-egg under FORCE RLS: the row can only be read inside its own
    // tenant's session, but the tenant id is only known by reading the row.
    // The SECURITY DEFINER listing is the way in — it is already scoped to
    // live sessions, which is exactly the set that can legitimately be stopped.
    const active = await this.listActive();
    const session = active.find((s) => s.id === sessionId);
    if (!session) {
      throw new NotFoundException("No active impersonation session with that id");
    }
    if (session.impersonatorId !== impersonatorId) {
      // Not a security boundary against a genuine L2 operator (they can see
      // every session below), but stopping someone else's session silently
      // would corrupt the audit trail's "who ended this and why" story.
      throw new ForbiddenException(
        "Only the operator who started this session may end it directly.",
      );
    }

    const updated = await runWithTenantSession(
      { tenantId: session.tenantId, userId: impersonatorId },
      () =>
        (prisma as any).impersonationSession.update({
          where: { id: sessionId },
          data: { status: "EXPIRED" },
        }),
    );

    await runWithTenantSession({ tenantId: session.tenantId, userId: impersonatorId }, () =>
      prisma.auditLog.create({
      data: {
        tenantId: session.tenantId,
        userId: impersonatorId,
        action: "SUPPORT_IMPERSONATION_STOP",
        entityType: "ImpersonationSession",
        entityId: session.id,
        changes: {
          impersonatorId,
          impersonatorEmail,
          targetUserId: session.targetUserId,
        },
      },
      }),
    );

    return updated;
  }

  /**
   * Estate-wide: every live support session across all tenants. This is the
   * one read here that is legitimately cross-tenant, so FORCE RLS makes it
   * impossible from the application role by design — it goes through the
   * SECURITY DEFINER `support_list_active_impersonations()` function instead
   * (W9 migration), mirroring `auth_lookup_oauth_identity()`'s audited
   * exception for its own pre-tenant-context lookup.
   *
   * Authorization is NOT conferred by reaching this method: the controller
   * gates it behind ControlPlaneGuard plus `platform.support.l2`.
   */
  async listActive() {
    const rows = await prisma.$queryRaw<
      ActiveImpersonationRow[]
    >`SELECT * FROM support_list_active_impersonations()`;

    // Mapped to the camelCase shape the rest of this service and its callers
    // use, so the SECURITY DEFINER detour doesn't leak snake_case into the API.
    return rows.map((r) => ({
      id: r.id,
      tenantId: r.tenant_id,
      impersonatorId: r.impersonator_id,
      targetUserId: r.target_user_id,
      consentId: r.consent_id,
      status: r.status,
      expiresAt: r.expires_at,
      createdAt: r.created_at,
    }));
  }
}
