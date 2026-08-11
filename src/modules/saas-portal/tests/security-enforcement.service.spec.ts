/**
 * D22 exit criterion (SSO-only + MFA-for-admins half): "A tenant
 * enforces SSO-only access and MFA for admins ..."
 *
 * getMfaSettings/getSsoConfigs were pure storage with zero consumer
 * anywhere in the codebase before this — a tenant could "configure"
 * SSO-only or MFA-enforced and nothing would ever actually check it at
 * login. This spec proves the real enforcement mechanism.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

let settings: any[];

vi.mock("@kannan19302/database", () => ({
  prisma: {
    setting: {
      findUnique: vi.fn(({ where }: any) => {
        const { tenantId, key } = where.tenantId_key;
        return settings.find((s) => s.tenantId === tenantId && s.key === key) ?? null;
      }),
      upsert: vi.fn(({ where, create, update }: any) => {
        const { tenantId, key } = where.tenantId_key;
        const existing = settings.find((s) => s.tenantId === tenantId && s.key === key);
        if (existing) {
          Object.assign(existing, update);
          return existing;
        }
        settings.push(create);
        return create;
      }),
    },
  },
}));

import { TenantSecurityEnforcementService } from "../services/security-enforcement.service";

describe("D22 · SSO-only access and MFA-for-admins are ENFORCED, not just stored", () => {
  let enforcement: TenantSecurityEnforcementService;

  beforeEach(() => {
    vi.clearAllMocks();
    settings = [];
    enforcement = new TenantSecurityEnforcementService();
  });

  it("with NO policy configured, a normal password login is allowed", async () => {
    const result = await enforcement.assertLoginAllowed("t1", { authMethod: "PASSWORD", userRole: "USER", mfaVerified: false });
    expect(result.allowed).toBe(true);
  });

  it("SSO-ONLY: once enforced, a PASSWORD login is REFUSED", async () => {
    await enforcement.saveAccessPolicy("t1", { ssoOnly: true });
    await expect(enforcement.assertLoginAllowed("t1", { authMethod: "PASSWORD", userRole: "USER", mfaVerified: false })).rejects.toThrow(/SSO-only/);
  });

  it("SSO-ONLY: an SSO login is still allowed once enforced", async () => {
    await enforcement.saveAccessPolicy("t1", { ssoOnly: true });
    const result = await enforcement.assertLoginAllowed("t1", { authMethod: "SSO", userRole: "USER", mfaVerified: false });
    expect(result.allowed).toBe(true);
  });

  it("MFA FOR ADMINS: once enforced, an ADMIN login with no verified MFA is REFUSED", async () => {
    await (await import("@kannan19302/database")).prisma.setting.upsert({
      where: { tenantId_key: { tenantId: "t1", key: "security.mfa-settings" } },
      create: { tenantId: "t1", key: "security.mfa-settings", value: { enabled: true, mfaType: "TOTP", enforced: true } },
      update: { value: { enabled: true, mfaType: "TOTP", enforced: true } },
    });

    await expect(enforcement.assertLoginAllowed("t1", { authMethod: "PASSWORD", userRole: "ADMIN", mfaVerified: false })).rejects.toThrow(/MFA/);
  });

  it("MFA FOR ADMINS: an admin WITH verified MFA is allowed", async () => {
    await (await import("@kannan19302/database")).prisma.setting.upsert({
      where: { tenantId_key: { tenantId: "t1", key: "security.mfa-settings" } },
      create: { tenantId: "t1", key: "security.mfa-settings", value: { enabled: true, mfaType: "TOTP", enforced: true } },
      update: { value: { enabled: true, mfaType: "TOTP", enforced: true } },
    });

    const result = await enforcement.assertLoginAllowed("t1", { authMethod: "PASSWORD", userRole: "ADMIN", mfaVerified: true });
    expect(result.allowed).toBe(true);
  });

  it("MFA enforced applies ONLY to admin roles — a regular USER without MFA is unaffected", async () => {
    await (await import("@kannan19302/database")).prisma.setting.upsert({
      where: { tenantId_key: { tenantId: "t1", key: "security.mfa-settings" } },
      create: { tenantId: "t1", key: "security.mfa-settings", value: { enabled: true, mfaType: "TOTP", enforced: true } },
      update: { value: { enabled: true, mfaType: "TOTP", enforced: true } },
    });

    const result = await enforcement.assertLoginAllowed("t1", { authMethod: "PASSWORD", userRole: "USER", mfaVerified: false });
    expect(result.allowed).toBe(true);
  });

  it("policies are tenant-scoped — tenant A's SSO-only enforcement never affects tenant B", async () => {
    await enforcement.saveAccessPolicy("t1", { ssoOnly: true });
    const result = await enforcement.assertLoginAllowed("t2", { authMethod: "PASSWORD", userRole: "USER", mfaVerified: false });
    expect(result.allowed).toBe(true);
  });
});
