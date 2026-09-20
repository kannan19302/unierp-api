import { describe, it, expect, vi, beforeEach } from "vitest";

const mockUsers: any[] = [];
const mockRoles: any[] = [];
const mockUserRoles: any[] = [];
const mockSessions: any[] = [];

vi.mock("@kannan19302/database", () => ({
  prisma: {},
  runWithTenantSession: vi.fn((_ctx, fn) => fn()),
}));

vi.mock("../../common/idp-client", () => ({
  idpClient: {
    user: {
      findMany: vi.fn(async () => mockUsers),
      findFirst: vi.fn(async ({ where }: any) => mockUsers.find((u) => u.id === where.id) ?? null),
      count: vi.fn(async () => mockUsers.length),
      create: vi.fn(async ({ data }: any) => {
        const u = { id: `user-${mockUsers.length + 1}`, ...data };
        mockUsers.push(u);
        return u;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const u = mockUsers.find((x) => x.id === where.id);
        if (u) Object.assign(u, data);
        return u;
      }),
    },
    role: {
      findMany: vi.fn(async () => mockRoles),
      findFirst: vi.fn(async ({ where }: any) => mockRoles.find((r) => r.id === where.id) ?? null),
      count: vi.fn(async () => mockRoles.length),
      create: vi.fn(async ({ data }: any) => {
        const r = { id: `role-${mockRoles.length + 1}`, _count: { users: 0 }, ...data };
        mockRoles.push(r);
        return r;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const r = mockRoles.find((x) => x.id === where.id);
        if (r) Object.assign(r, data);
        return r;
      }),
      delete: vi.fn(async ({ where }: any) => {
        const idx = mockRoles.findIndex((x) => x.id === where.id);
        if (idx !== -1) mockRoles.splice(idx, 1);
        return { id: where.id };
      }),
    },
    userRole: {
      create: vi.fn(async ({ data }: any) => {
        mockUserRoles.push(data);
        return data;
      }),
      deleteMany: vi.fn(async ({ where }: any) => {
        const initial = mockUserRoles.length;
        const kept = mockUserRoles.filter((ur) => ur.userId !== where.userId);
        mockUserRoles.length = 0;
        mockUserRoles.push(...kept);
        return { count: initial - kept.length };
      }),
    },
    userSession: {
      findMany: vi.fn(async () => mockSessions),
      findFirst: vi.fn(async ({ where }: any) => mockSessions.find((s) => s.id === where.id) ?? null),
      update: vi.fn(async ({ where, data }: any) => {
        const s = mockSessions.find((x) => x.id === where.id);
        if (s) Object.assign(s, data);
        return s;
      }),
      updateMany: vi.fn(async ({ data }: any) => {
        mockSessions.forEach((s) => Object.assign(s, data));
        return { count: mockSessions.length };
      }),
    },
  },
}));

vi.mock("@kannan19302/shared", () => ({
  parseRolePermissions: vi.fn((perms: any) => {
    if (Array.isArray(perms)) return perms;
    if (typeof perms === "string") {
      try {
        return JSON.parse(perms);
      } catch {
        return [];
      }
    }
    return [];
  }),
}));

import { StaffIdpService } from "./staff-idp.service";

describe("StaffIdpService CRUD & Governance", () => {
  let service: StaffIdpService;
  const mockProviders: any = { registerProvider: vi.fn(), bindCapability: vi.fn(), registerAdapter: vi.fn() };
  const mockRouting: any = { resolve: vi.fn() };
  const mockAudit: any = { record: vi.fn() };
  const mockConsoleGateway: any = { server: { emit: vi.fn() } };

  beforeEach(() => {
    mockUsers.length = 0;
    mockRoles.length = 0;
    mockUserRoles.length = 0;
    mockSessions.length = 0;
    vi.clearAllMocks();

    service = new StaffIdpService(mockProviders, mockRouting, mockAudit, mockConsoleGateway);
  });

  it("creates a role and emits audit & websocket events", async () => {
    const role = await service.createRole(
      "provider-tenant-1",
      {
        name: "Security Lead",
        description: "Oversees IAM policies",
        permissions: ["pcc.identity-governance.access", "pcc.security.view"],
      },
      { actorId: "admin-1", actorRole: "SUPER_ADMIN" },
    );

    expect(role.name).toBe("Security Lead");
    expect(mockAudit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "staff.role.create",
        actorId: "admin-1",
      }),
    );
    expect(mockConsoleGateway.server.emit).toHaveBeenCalledWith(
      "domain.update",
      expect.objectContaining({ domain: "access", action: "create", entity: "role" }),
    );
  });

  it("creates a staff principal with assigned roles", async () => {
    const user = await service.createPrincipal(
      "provider-tenant-1",
      {
        email: "alice@unierp.internal",
        firstName: "Alice",
        lastName: "Operator",
        roleIds: ["role-1"],
      },
      { actorId: "admin-1", actorRole: "SUPER_ADMIN" },
    );

    expect(user.email).toBe("alice@unierp.internal");
    expect(mockAudit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "staff.principal.create",
        actorId: "admin-1",
      }),
    );
    expect(mockConsoleGateway.server.emit).toHaveBeenCalledWith(
      "domain.update",
      expect.objectContaining({ domain: "access", action: "create", entity: "principal" }),
    );
  });

  it("revokes a session and emits audit & websocket events", async () => {
    mockSessions.push({
      id: "sess-1",
      userId: "user-1",
      tenantId: "provider-tenant-1",
      isActive: true,
      ipAddress: "127.0.0.1",
    });

    const res = await service.revokeSession(
      "provider-tenant-1",
      "sess-1",
      { actorId: "admin-1", actorRole: "SUPER_ADMIN" },
    );

    expect(res.success).toBe(true);
    expect(mockSessions[0].isActive).toBe(false);
    expect(mockAudit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "staff.session.revoke",
        targetId: "sess-1",
      }),
    );
  });
});
