/**
 * D03 exit criterion: "A tenant admin builds a custom role and the
 * two-tenant isolation test still passes. A delegation expires
 * automatically. No tenant role can grant a `platform.*` permission."
 *
 * AdminService.assertNoPlatformOnlyPermissions() (pre-existing) only
 * rejects a code flagged `platformOnly: true` on its PERMISSION_REGISTRY
 * entry — a manually-maintained flag, set on only 2 of the ~20 `system.*`/
 * `platform.*` (control-plane) codes actually registered. Every other
 * control-plane code — including every `system.*` code Track M added this
 * session — was assignable to a tenant custom role with ZERO code change,
 * purely because nobody remembered to set the flag. This spec proves that
 * gap directly, then proves the fix: rejection based on the NAMESPACE
 * (`CONTROL_PLANE_NAMESPACES`, the same constant `hasPermission()` and
 * `ControlPlaneGuard` already enforce), unioned with the pre-existing
 * `platformOnly` flag rather than replacing it.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

let roles: any[];
let seq = 0;
const nextId = (p: string) => `${p}-${++seq}`;

vi.mock("@kannan19302/database", () => ({ prisma: {} }));
vi.mock("@/common/idp-client", () => ({
  idpClient: {
    role: {
      create: vi.fn(({ data }: any) => { const row = { id: nextId("role"), createdAt: new Date(), ...data }; roles.push(row); return row; }),
      findMany: vi.fn(({ where }: any) => roles.filter((r) => r.tenantId === where.tenantId)),
    },
  },
}));

import { AdminService } from "../admin.service";

describe("D03 · tenant custom roles cannot grant a control-plane permission", () => {
  let service: AdminService;

  beforeEach(() => {
    vi.clearAllMocks();
    roles = [];
    service = new AdminService();
  });

  it("REFUSES a `system.*` permission that was never flagged platformOnly — the real, previously unenforced gap", async () => {
    // system.retention.manage (M37) has no `platformOnly` flag set on its
    // PERMISSION_REGISTRY entry — before this phase's fix, this call
    // succeeded and created a tenant role that could grant it.
    await expect(
      service.createRole("tenant-a", { name: "Sneaky Role", permissions: ["system.retention.manage"] }),
    ).rejects.toThrow(/not assignable to tenant/i);
    expect(roles).toHaveLength(0);
  });

  it("REFUSES a `platform.*` permission the same way", async () => {
    await expect(
      service.createRole("tenant-a", { name: "Sneaky Role 2", permissions: ["platform.some.made.up.code"] }),
    ).rejects.toThrow(/not assignable to tenant/i);
    expect(roles).toHaveLength(0);
  });

  it("still refuses a permission explicitly flagged platformOnly, even outside the system/platform namespace (saas.analytics.read) — the pre-existing check is preserved, not replaced", async () => {
    await expect(
      service.createRole("tenant-a", { name: "Sneaky Role 3", permissions: ["saas.analytics.read"] }),
    ).rejects.toThrow(/not assignable to tenant/i);
  });

  it("BUILDS a custom role with ordinary tenant permissions", async () => {
    const role = await service.createRole("tenant-a", { name: "Support Rep", permissions: ["admin.users.read", "admin.tickets.manage"] });
    expect(role.name).toBe("Support Rep");
    expect(roles).toHaveLength(1);
  });

  it("TWO-TENANT ISOLATION still holds: tenant A's custom role is never visible to tenant B", async () => {
    await service.createRole("tenant-a", { name: "Support Rep", permissions: ["admin.users.read"] });
    await service.createRole("tenant-b", { name: "Support Rep", permissions: ["admin.tickets.manage"] });

    const tenantARoles = await service.getRoles("tenant-a");
    const tenantBRoles = await service.getRoles("tenant-b");

    expect((tenantARoles as any[])).toHaveLength(1);
    expect((tenantBRoles as any[])).toHaveLength(1);
    expect((tenantARoles as any[])[0].tenantId).toBe("tenant-a");
    expect((tenantBRoles as any[])[0].tenantId).toBe("tenant-b");
    // Same role NAME in both tenants, but never the same row.
    expect((tenantARoles as any[])[0].id).not.toBe((tenantBRoles as any[])[0].id);
  });
});
