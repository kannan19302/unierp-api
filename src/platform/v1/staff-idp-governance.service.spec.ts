import { NotFoundException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  runWithTenantSession: vi.fn(
    (_session: unknown, operation: () => unknown) => operation(),
  ),
  prisma: {
    accessPackage: { findMany: vi.fn() },
    roleAccessPackage: { findMany: vi.fn() },
  },
  idpPrisma: {
    user: { findMany: vi.fn(), findFirst: vi.fn() },
    userGroup: { findMany: vi.fn() },
    role: { findMany: vi.fn() },
    apiKey: { findMany: vi.fn() },
    authApiToken: { findMany: vi.fn() },
    userSession: { findMany: vi.fn() },
  },
}));

vi.mock("@kannan19302/database", () => db);

import { StaffIdpService } from "./staff-idp.service";

describe("PCC-03 provider identity governance read models", () => {
  let service: StaffIdpService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new StaffIdpService({} as never, {} as never);
  });

  it("returns provider principals without password, MFA seed, or session token fields", async () => {
    db.idpPrisma.user.findMany.mockResolvedValue([
      {
        id: "operator-1",
        email: "operator@example.com",
        firstName: "Platform",
        lastName: "Operator",
        status: "ACTIVE",
        mfaEnabled: true,
        lastLoginAt: new Date("2026-08-24T00:00:00Z"),
        _count: { userSessions: 2 },
        roles: [{ role: { id: "role-1", name: "Platform Support" } }],
      },
    ]);

    const result = await service.listPrincipals("tnt-provider");

    expect(db.runWithTenantSession).toHaveBeenCalledWith(
      { tenantId: "tnt-provider", userId: "provider-control-plane" },
      expect.any(Function),
    );
    expect(result).toEqual([
      expect.objectContaining({
        id: "operator-1",
        activeSessionCount: 2,
        roles: [{ id: "role-1", name: "Platform Support" }],
      }),
    ]);
    expect(db.idpPrisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId: "tnt-provider", deletedAt: null },
        select: expect.not.objectContaining({
          passwordHash: expect.anything(),
          mfaSecret: expect.anything(),
        }),
      }),
    );
    expect(JSON.stringify(result)).not.toContain("passwordHash");
    expect(JSON.stringify(result)).not.toContain("mfaSecret");
  });

  it("projects service-principal metadata while never selecting credential hashes", async () => {
    db.idpPrisma.apiKey.findMany.mockResolvedValue([
      {
        id: "key-1",
        name: "Deployment automation",
        prefix: "erp_live_abcd",
        status: "ACTIVE",
        apiScopes: "deploy.read, deploy.execute",
        ipWhitelist: "10.0.0.0/8",
        expiresAt: null,
        createdAt: new Date(0),
        updatedAt: new Date(0),
      },
    ]);
    db.idpPrisma.authApiToken.findMany.mockResolvedValue([
      {
        id: "token-1",
        userId: "operator-1",
        name: "CLI",
        scopes: '["audit.read"]',
        expiresAt: null,
        lastUsedAt: null,
        createdAt: new Date(0),
      },
    ]);

    const result = await service.listServicePrincipals("tnt-provider");

    expect(result).toEqual([
      expect.objectContaining({
        kind: "API_KEY",
        id: "key-1",
        scopes: ["deploy.read", "deploy.execute"],
      }),
      expect.objectContaining({
        kind: "USER_TOKEN",
        id: "token-1",
        scopes: ["audit.read"],
      }),
    ]);
    for (const call of [
      db.idpPrisma.apiKey.findMany.mock.calls[0]?.[0],
      db.idpPrisma.authApiToken.findMany.mock.calls[0]?.[0],
    ]) {
      expect(call.select).not.toHaveProperty("hashedKey");
      expect(call.select).not.toHaveProperty("tokenHash");
    }
  });

  it("resolves provider effective access with access-package provenance", async () => {
    db.idpPrisma.user.findFirst.mockResolvedValue({
      id: "operator-1",
      email: "operator@example.com",
      status: "ACTIVE",
      mfaEnabled: true,
      roles: [
        {
          role: {
            id: "role-1",
            name: "Platform Support",
            permissions: '["system.tenant.read","pcc.identity-governance.access"]',
          },
        },
      ],
    });
    db.prisma.roleAccessPackage.findMany.mockResolvedValue([
      {
        roleId: "role-1",
        accessPackageId: "pkg-1",
        accessPackage: {
          id: "pkg-1",
          name: "Incident responder",
          permissions: ["system.incident.read"],
        },
      },
    ]);

    const result = await service.getEffectiveAccess(
      "tnt-provider",
      "operator-1",
    );

    expect(db.idpPrisma.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: "operator-1",
          tenantId: "tnt-provider",
          deletedAt: null,
        },
      }),
    );
    expect(result.effectivePermissions).toEqual([
      "pcc.identity-governance.access",
      "system.incident.read",
      "system.tenant.read",
    ]);
    expect(result.accessPackages).toEqual([
      {
        id: "pkg-1",
        name: "Incident responder",
        roleIds: ["role-1"],
        permissions: ["system.incident.read"],
      },
    ]);
  });

  it("does not reveal a principal outside the provider realm", async () => {
    db.idpPrisma.user.findFirst.mockResolvedValue(null);

    await expect(
      service.getEffectiveAccess("tnt-provider", "customer-user"),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(db.prisma.roleAccessPackage.findMany).not.toHaveBeenCalled();
  });
});
