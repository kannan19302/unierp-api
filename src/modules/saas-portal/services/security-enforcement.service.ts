/**
 * D22 — turns the tenant's stored MFA/SSO settings (SecurityService's
 * existing getMfaSettings/getSsoConfigs — pure storage, no consumer
 * anywhere in the codebase before this) into REAL enforcement. A
 * tenant "enforces SSO-only access and MFA for admins" is this
 * service's own assertLoginAllowed() — the check a login flow (in
 * this repo or the IdP, over the network) calls before completing a
 * session, not a setting nobody reads.
 */
import { Injectable, ForbiddenException } from "@nestjs/common";
import { prisma } from "@kannan19302/database";

export type AuthMethod = "PASSWORD" | "SSO";

export interface AccessPolicy {
  ssoOnly: boolean;
}

export interface LoginAttempt {
  authMethod: AuthMethod;
  userRole: string;
  mfaVerified: boolean;
}

const ADMIN_ROLES = new Set(["ADMIN", "SUPER_ADMIN", "OWNER"]);
const ACCESS_POLICY_KEY = "security.access-policy";
const MFA_SETTINGS_KEY = "security.mfa-settings";

@Injectable()
export class TenantSecurityEnforcementService {
  async getAccessPolicy(tenantId: string): Promise<AccessPolicy> {
    const setting = await (prisma as any).setting.findUnique({
      where: { tenantId_key: { tenantId, key: ACCESS_POLICY_KEY } },
    });
    return (setting?.value as AccessPolicy) ?? { ssoOnly: false };
  }

  async saveAccessPolicy(tenantId: string, policy: AccessPolicy) {
    return (prisma as any).setting.upsert({
      where: { tenantId_key: { tenantId, key: ACCESS_POLICY_KEY } },
      update: { value: policy as any, category: "security" },
      create: { tenantId, key: ACCESS_POLICY_KEY, value: policy as any, category: "security" },
    });
  }

  /**
   * The enforcement itself. Refuses (ForbiddenException, naming the
   * exact policy violated) a PASSWORD login when SSO-only is enforced,
   * and refuses an admin-role login with no verified MFA when MFA is
   * enforced. A login that violates neither refusal is allowed.
   */
  async assertLoginAllowed(tenantId: string, attempt: LoginAttempt): Promise<{ allowed: true }> {
    const policy = await this.getAccessPolicy(tenantId);
    if (policy.ssoOnly && attempt.authMethod === "PASSWORD") {
      throw new ForbiddenException("This tenant enforces SSO-only access — password login is refused");
    }

    const mfaSetting = await (prisma as any).setting.findUnique({
      where: { tenantId_key: { tenantId, key: MFA_SETTINGS_KEY } },
    });
    const mfa = (mfaSetting?.value as { enforced?: boolean }) ?? { enforced: false };
    if (mfa.enforced && ADMIN_ROLES.has(attempt.userRole) && !attempt.mfaVerified) {
      throw new ForbiddenException("This tenant enforces MFA for admin roles — a verified MFA challenge is required");
    }

    return { allowed: true };
  }
}
