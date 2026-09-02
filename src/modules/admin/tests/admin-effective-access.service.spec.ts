import { NotFoundException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    accessPackage: {
      findFirst: vi.fn(),
    },
    roleAccessPackage: {
      findMany: vi.fn(),
      upsert: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
  idpPrisma: {
    user: {
      findFirst: vi.fn(),
    },
    role: {
      findFirst: vi.fn(),
    },
  },
}));

vi.mock("@kannan19302/database", () => mocks);

import { AdminService } from "../services/admin.service";

describe("AdminService effective access tenant boundary", () => {
  let service: AdminService;

  beforeEach(() => {
    vi.resetAllMocks();
    service = new AdminService();
  });

  it("returns deterministic permissions with role and package provenance", async () => {
    mocks.idpPrisma.user.findFirst.mockResolvedValue({
      id: "user-1",
      email: "person@example.com",
      status: "ACTIVE",
      roles: [
        {
          role: {
            id: "role-2",
            name: "Reviewer",
            permissions: ["documents.read", "documents.comment"],
          },
        },
        {
          role: {
            id: "role-1",
            name: "Approver",
            permissions: '["documents.approve","documents.read"]',
          },
        },
      ],
    });
    mocks.prisma.roleAccessPackage.findMany.mockResolvedValue([
      {
        roleId: "role-2",
        accessPackageId: "package-1",
        accessPackage: {
          id: "package-1",
          name: "Finance Core",
          permissions: '["finance.invoice.read","documents.read"]',
        },
      },
      {
        roleId: "role-1",
        accessPackageId: "package-1",
        accessPackage: {
          id: "package-1",
          name: "Finance Core",
          permissions: '["finance.invoice.read","documents.read"]',
        },
      },
      {
        roleId: "role-1",
        accessPackageId: "package-2",
        accessPackage: {
          id: "package-2",
          name: "Malformed Legacy Grant",
          permissions: "not-json",
        },
      },
    ]);

    const result = await service.getEffectiveAccess("tenant-1", "user-1");

    expect(mocks.idpPrisma.user.findFirst).toHaveBeenCalledWith({
      where: { id: "user-1", tenantId: "tenant-1", deletedAt: null },
      include: {
        roles: {
          where: { role: { tenantId: "tenant-1" } },
          include: { role: true },
        },
      },
    });
    expect(mocks.prisma.roleAccessPackage.findMany).toHaveBeenCalledWith({
      where: {
        roleId: { in: ["role-2", "role-1"] },
        accessPackage: { tenantId: "tenant-1" },
      },
      include: { accessPackage: true },
    });
    expect(result).toEqual({
      user: {
        id: "user-1",
        email: "person@example.com",
        status: "ACTIVE",
      },
      roles: [
        {
          id: "role-1",
          name: "Approver",
          permissions: ["documents.approve", "documents.read"],
        },
        {
          id: "role-2",
          name: "Reviewer",
          permissions: ["documents.comment", "documents.read"],
        },
      ],
      accessPackages: [
        {
          id: "package-1",
          name: "Finance Core",
          roleIds: ["role-1", "role-2"],
          permissions: ["documents.read", "finance.invoice.read"],
        },
        {
          id: "package-2",
          name: "Malformed Legacy Grant",
          roleIds: ["role-1"],
          permissions: [],
        },
      ],
      effectivePermissions: [
        "documents.approve",
        "documents.comment",
        "documents.read",
        "finance.invoice.read",
      ],
    });
  });

  it("does not query packages when the user has no roles", async () => {
    mocks.idpPrisma.user.findFirst.mockResolvedValue({
      id: "user-1",
      email: "person@example.com",
      status: "ACTIVE",
      roles: [],
    });

    const result = await service.getEffectiveAccess("tenant-1", "user-1");

    expect(mocks.prisma.roleAccessPackage.findMany).not.toHaveBeenCalled();
    expect(result.roles).toEqual([]);
    expect(result.accessPackages).toEqual([]);
    expect(result.effectivePermissions).toEqual([]);
  });

  it("hides users outside the authenticated tenant", async () => {
    mocks.idpPrisma.user.findFirst.mockResolvedValue(null);

    await expect(
      service.getEffectiveAccess("tenant-1", "foreign-user"),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(mocks.prisma.roleAccessPackage.findMany).not.toHaveBeenCalled();
  });

  it("rejects a package assignment when either side is outside the tenant", async () => {
    mocks.prisma.accessPackage.findFirst.mockResolvedValue(null);
    mocks.idpPrisma.role.findFirst.mockResolvedValue({ id: "role-1" });

    await expect(
      service.assignAccessPackageToRole(
        "tenant-1",
        "foreign-package",
        "role-1",
      ),
    ).rejects.toMatchObject({
      message: "Access package or role not found",
    });
    expect(mocks.prisma.roleAccessPackage.upsert).not.toHaveBeenCalled();
  });

  it("assigns idempotently after validating both tenant-owned objects", async () => {
    mocks.prisma.accessPackage.findFirst.mockResolvedValue({ id: "package-1" });
    mocks.idpPrisma.role.findFirst.mockResolvedValue({ id: "role-1" });
    mocks.prisma.roleAccessPackage.upsert.mockResolvedValue({
      roleId: "role-1",
      accessPackageId: "package-1",
    });

    await service.assignAccessPackageToRole(
      "tenant-1",
      "package-1",
      "role-1",
    );

    expect(mocks.prisma.accessPackage.findFirst).toHaveBeenCalledWith({
      where: { id: "package-1", tenantId: "tenant-1" },
      select: { id: true },
    });
    expect(mocks.idpPrisma.role.findFirst).toHaveBeenCalledWith({
      where: { id: "role-1", tenantId: "tenant-1" },
      select: { id: true },
    });
    expect(mocks.prisma.roleAccessPackage.upsert).toHaveBeenCalledWith({
      where: {
        roleId_accessPackageId: {
          roleId: "role-1",
          accessPackageId: "package-1",
        },
      },
      create: { roleId: "role-1", accessPackageId: "package-1" },
      update: {},
    });
  });

  it("reports a missing assignment without deleting anything outside the tenant", async () => {
    mocks.prisma.accessPackage.findFirst.mockResolvedValue({ id: "package-1" });
    mocks.idpPrisma.role.findFirst.mockResolvedValue({ id: "role-1" });
    mocks.prisma.roleAccessPackage.deleteMany.mockResolvedValue({ count: 0 });

    await expect(
      service.unassignAccessPackageFromRole(
        "tenant-1",
        "package-1",
        "role-1",
      ),
    ).rejects.toMatchObject({ message: "Access package assignment not found" });
    expect(mocks.prisma.roleAccessPackage.deleteMany).toHaveBeenCalledWith({
      where: { roleId: "role-1", accessPackageId: "package-1" },
    });
  });
});
