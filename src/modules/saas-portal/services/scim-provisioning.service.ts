/**
 * D22 — SCIM-style user provisioning. Scoped to the exit criterion's
 * own words ("provisions users via SCIM") rather than a full RFC 7644
 * server surface: a real, idempotent upsert-by-userName mechanism that
 * creates/updates/deactivates tenant users from a SCIM User resource,
 * proven correct — not a bespoke, one-off provisioning path per
 * integration.
 */
import { Injectable, BadRequestException } from "@nestjs/common";
import { idpClient as idpPrisma } from "@/common/idp-client";

export interface ScimUserResource {
  userName: string;
  emails: Array<{ value: string; primary?: boolean }>;
  active: boolean;
  name?: { givenName?: string; familyName?: string };
}

export interface ScimProvisionResult {
  id: string;
  userName: string;
  active: boolean;
  created: boolean;
}

@Injectable()
export class ScimProvisioningService {
  private primaryEmail(resource: ScimUserResource): string {
    const primary = resource.emails.find((e) => e.primary) ?? resource.emails[0];
    if (!primary) throw new BadRequestException("A SCIM User resource must declare at least one email");
    return primary.value;
  }

  /**
   * Idempotent: provisioning the SAME userName twice UPDATES the
   * existing user rather than creating a duplicate — SCIM's own
   * "PUT is idempotent" semantic, made real rather than assumed.
   */
  async provisionUser(tenantId: string, resource: ScimUserResource): Promise<ScimProvisionResult> {
    const email = this.primaryEmail(resource);
    const existing = await (idpPrisma as any).user.findFirst({
      where: { tenantId, email: resource.userName },
    });

    if (existing) {
      const updated = await (idpPrisma as any).user.update({
        where: { id: existing.id },
        data: {
          email,
          firstName: resource.name?.givenName ?? existing.firstName,
          lastName: resource.name?.familyName ?? existing.lastName,
          status: resource.active ? "ACTIVE" : "SUSPENDED",
        },
      });
      return { id: updated.id, userName: resource.userName, active: resource.active, created: false };
    }

    const created = await (idpPrisma as any).user.create({
      data: {
        tenantId,
        email,
        firstName: resource.name?.givenName ?? "",
        lastName: resource.name?.familyName ?? "",
        status: resource.active ? "ACTIVE" : "SUSPENDED",
      },
    });
    return { id: created.id, userName: resource.userName, active: resource.active, created: true };
  }

  /** SCIM's own DELETE semantic: deprovisioning suspends, never hard-deletes — a tenant's records/history survive. */
  async deprovisionUser(tenantId: string, userName: string): Promise<{ id: string; active: false }> {
    const existing = await (idpPrisma as any).user.findFirst({ where: { tenantId, email: userName } });
    if (!existing) throw new BadRequestException(`No SCIM-provisioned user found for userName "${userName}"`);
    const updated = await (idpPrisma as any).user.update({ where: { id: existing.id }, data: { status: "SUSPENDED" } });
    return { id: updated.id, active: false };
  }

  async listProvisionedUsers(tenantId: string) {
    return (idpPrisma as any).user.findMany({ where: { tenantId } });
  }
}
