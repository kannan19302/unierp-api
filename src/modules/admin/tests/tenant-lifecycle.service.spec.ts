import { prisma } from "@kannan19302/database";
import { idpClient as idpPrisma } from "@/common/idp-client";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { TenantLifecycleService } from "../../../platform/v1/tenant-lifecycle.service";
import { DurableExecutorService } from "../../../platform/operation-pipeline/durable-executor.service";
import { PrismaJobStateStore } from "../../../platform/operation-pipeline/prisma-job-state-store";
import {
  NotFoundException,
  BadRequestException,
  ConflictException,
} from "@nestjs/common";

vi.mock("@kannan19302/database", () => {
  const lastJobRow: any = {};
  const mockTx = {
    tenant: {
      update: vi.fn(),
      delete: vi.fn(),
      findUnique: vi.fn(),
    },
    userSession: {
      deleteMany: vi.fn(),
    },
    tenantLifecycleEvent: {
      create: vi.fn(),
      findMany: vi.fn(),
    },
    user: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
    role: {
      findMany: vi.fn(),
    },
    organization: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
  };

  // Identity models (user, role, userSession, ...) are read through
  // `idpPrisma`, not `prisma` â€” this spec predates that split and stubs
  // them under `prisma`. Exporting the same stub object under both names
  // keeps every `vi.mocked(prisma.user.*)` setup pointing at exactly the
  // function the service calls.
  const mocked = {
    prisma: {
      tenant: {
        findUnique: vi.fn(),
        findMany: vi.fn(),
        count: vi.fn(),
        // Used by suspendTenant's compensator (M12) if session revocation
        // fails after the status change already committed — not exercised
        // by the happy-path tests, but a real capability the production
        // client has, so it belongs on the mock regardless.
        update: vi.fn(),
      },
      user: {
        findMany: vi.fn(),
        count: vi.fn(),
      },
      organization: {
        findMany: vi.fn(),
        count: vi.fn(),
      },
      role: {
        findMany: vi.fn(),
      },
      userSession: {
        deleteMany: vi.fn(),
      },
      tenantLifecycleEvent: {
        findMany: vi.fn(),
        create: vi.fn(),
      },
      // Each test creates at most one Job (one suspend/unsuspend call), so
      // tracking "the last created row" — rather than a real id-keyed map,
      // which vi.mock's hoisting makes awkward to reset per test — is
      // sufficient here without being a special case per test.
      job: {
        create: vi.fn(({ data }: any) => {
          Object.assign(lastJobRow, data);
          return { ...lastJobRow };
        }),
        findUnique: vi.fn(() => (lastJobRow.id ? { ...lastJobRow } : null)),
        update: vi.fn(({ data }: any) => {
          Object.assign(lastJobRow, data);
          return { ...lastJobRow };
        }),
      },
      $transaction: vi.fn((cb: (tx: typeof mockTx) => unknown) => cb(mockTx)),
      _dmmf: {
        datamodel: {
          models: [
            { name: "Tenant", fields: [{ name: "id" }] },
            { name: "User", fields: [{ name: "tenantId" }] },
            { name: "Organization", fields: [{ name: "tenantId" }] },
            { name: "Role", fields: [{ name: "tenantId" }] },
            { name: "UserSession", fields: [{ name: "tenantId" }] },
          ],
        },
      },
    },
  };
  return { ...mocked, idpPrisma: mocked.prisma };
});

describe("TenantLifecycleService", () => {
  let service: TenantLifecycleService;

  beforeEach(() => {
    // Pre-existing bug, found while wiring M12: this file previously
    // constructed the service with ZERO arguments against a
    // single-parameter constructor, leaving consoleGateway undefined —
    // offboardTenant/cancelOffboarding/purgeTenant were already failing
    // with "Cannot read properties of undefined (reading 'emitTenantUpdate')"
    // before any of this session's changes (confirmed via git stash).
    // Filed as D051. Fixed here because this exact line also needs the new
    // DurableExecutorService dependency for M12's suspend/unsuspend wiring.
    const consoleGateway = { emitTenantUpdate: vi.fn() } as any;
    const executor = new DurableExecutorService(new PrismaJobStateStore());
    service = new TenantLifecycleService(consoleGateway, executor);
    vi.clearAllMocks();
  });

  const mockTenant = {
    id: "tenant-1",
    name: "Test Corp",
    slug: "test-corp",
    plan: "enterprise",
    status: "ACTIVE",
    settings: { theme: "dark" },
    createdAt: new Date("2025-01-01"),
    updatedAt: new Date("2025-06-01"),
    demoDataLoaded: false,
    demoLoadedAt: null,
  };

  describe("getLifecycleStatus", () => {
    it("should return lifecycle status and history", async () => {
      const { prisma } = await import("@kannan19302/database");
      prisma.tenant.findUnique.mockResolvedValue(mockTenant);
      prisma.tenantLifecycleEvent.findMany.mockResolvedValue([
        {
          id: "evt-1",
          eventType: "EXPORT",
          status: "COMPLETED",
          createdAt: new Date(),
        },
      ]);
      idpPrisma.user.count.mockResolvedValue(5);
      prisma.organization.count.mockResolvedValue(1);

      const result = await service.getLifecycleStatus("tenant-1");

      expect(result.tenant.id).toBe("tenant-1");
      expect(result.tenant.status).toBe("ACTIVE");
      expect(result.stats.users).toBe(5);
      expect(result.recentEvents).toHaveLength(1);
    });

    it("should throw NotFoundException for nonexistent tenant", async () => {
      const { prisma } = await import("@kannan19302/database");
      prisma.tenant.findUnique.mockResolvedValue(null);

      await expect(service.getLifecycleStatus("nonexistent")).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe("exportTenant", () => {
    it("should generate correct export manifest with data counts", async () => {
      const { prisma } = await import("@kannan19302/database");
      prisma.tenant.findUnique.mockResolvedValue(mockTenant);
      idpPrisma.user.findMany.mockResolvedValue([
        {
          id: "u-1",
          email: "a@b.com",
          firstName: "A",
          lastName: "B",
          status: "ACTIVE",
        },
      ]);
      prisma.organization.findMany.mockResolvedValue([
        { id: "org-1", name: "Test Org", tenantId: "tenant-1" },
      ]);
      idpPrisma.role.findMany.mockResolvedValue([]);

      const result = await service.exportTenant("tenant-1");

      expect(result.tenant.id).toBe("tenant-1");
      expect(result.data.users).toHaveLength(1);
      expect(result.data.organizations).toHaveLength(1);
      expect(result.exportedAt).toBeDefined();
    });

    it("should throw NotFoundException for nonexistent tenant", async () => {
      const { prisma } = await import("@kannan19302/database");
      prisma.tenant.findUnique.mockResolvedValue(null);

      await expect(service.exportTenant("nonexistent")).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe("suspendTenant", () => {
    it("should set tenant status to SUSPENDED and revoke sessions", async () => {
      const { prisma } = await import("@kannan19302/database");
      prisma.tenant.findUnique.mockResolvedValue(mockTenant);
      prisma.userSession.deleteMany.mockResolvedValue({ count: 3 });

      const result = await service.suspendTenant("tenant-1");

      expect(result.status).toBe("SUSPENDED");
      expect(prisma.$transaction).toHaveBeenCalled();
      expect(prisma.userSession.deleteMany).toHaveBeenCalledWith({ where: { user: { tenantId: "tenant-1" } } });
      // M12: this transition must genuinely run on the durable operation
      // pipeline, not just happen to produce the same end state — a Job
      // row is the observable proof of that, distinct from the tenant
      // status change itself.
      expect(prisma.job.create).toHaveBeenCalled();
      expect(result.jobId).toBeTruthy();
      expect(result.jobId).toBe((prisma.job.create as any).mock.calls[0][0].data.id);
    });

    it("should throw ConflictException if already suspended", async () => {
      const { prisma } = await import("@kannan19302/database");
      prisma.tenant.findUnique.mockResolvedValue({
        ...mockTenant,
        status: "SUSPENDED",
      });

      await expect(service.suspendTenant("tenant-1")).rejects.toThrow(
        ConflictException,
      );
    });

    it("should throw BadRequestException if purged", async () => {
      const { prisma } = await import("@kannan19302/database");
      prisma.tenant.findUnique.mockResolvedValue({
        ...mockTenant,
        status: "PURGED",
      });

      await expect(service.suspendTenant("tenant-1")).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe("unsuspendTenant", () => {
    it("should set tenant status back to ACTIVE", async () => {
      const { prisma } = await import("@kannan19302/database");
      prisma.tenant.findUnique.mockResolvedValue({
        ...mockTenant,
        status: "SUSPENDED",
      });

      const result = await service.unsuspendTenant("tenant-1");

      expect(result.status).toBe("ACTIVE");
    });

    it("should throw ConflictException if not suspended", async () => {
      const { prisma } = await import("@kannan19302/database");
      prisma.tenant.findUnique.mockResolvedValue(mockTenant);

      await expect(service.unsuspendTenant("tenant-1")).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe("offboardTenant", () => {
    it("should mark tenant as OFFBOARDING with retention window", async () => {
      const { prisma } = await import("@kannan19302/database");
      prisma.tenant.findUnique.mockResolvedValue(mockTenant);

      const result = await service.offboardTenant("tenant-1", 90);

      expect(result.status).toBe("OFFBOARDING");
      expect(result.retentionDays).toBe(90);
      expect(result.autoPurgeDate).toBeDefined();
    });

    it("should default to 90 day retention", async () => {
      const { prisma } = await import("@kannan19302/database");
      prisma.tenant.findUnique.mockResolvedValue(mockTenant);

      const result = await service.offboardTenant("tenant-1");

      expect(result.retentionDays).toBe(90);
    });

    it("should throw if tenant is already offboarding", async () => {
      const { prisma } = await import("@kannan19302/database");
      prisma.tenant.findUnique.mockResolvedValue({
        ...mockTenant,
        status: "OFFBOARDING",
      });

      await expect(service.offboardTenant("tenant-1")).rejects.toThrow(
        ConflictException,
      );
    });

    it("should throw if tenant was purged", async () => {
      const { prisma } = await import("@kannan19302/database");
      prisma.tenant.findUnique.mockResolvedValue({
        ...mockTenant,
        status: "PURGED",
      });

      await expect(service.offboardTenant("tenant-1")).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe("cancelOffboarding", () => {
    it("should restore tenant to ACTIVE", async () => {
      const { prisma } = await import("@kannan19302/database");
      prisma.tenant.findUnique.mockResolvedValue({
        ...mockTenant,
        status: "OFFBOARDING",
      });

      const result = await service.cancelOffboarding("tenant-1");

      expect(result.status).toBe("ACTIVE");
    });

    it("should throw if tenant is not offboarding", async () => {
      const { prisma } = await import("@kannan19302/database");
      prisma.tenant.findUnique.mockResolvedValue(mockTenant);

      await expect(service.cancelOffboarding("tenant-1")).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe("purgeTenant", () => {
    it("should delete all tenant data and the tenant record", async () => {
      const { prisma } = await import("@kannan19302/database");
      prisma.tenant.findUnique.mockResolvedValue(mockTenant);

      const result = await service.purgeTenant("tenant-1");

      expect(result.message).toBe("Tenant permanently purged");
      expect(prisma.$transaction).toHaveBeenCalled();
    });

    it("should throw if tenant was already purged", async () => {
      const { prisma } = await import("@kannan19302/database");
      prisma.tenant.findUnique.mockResolvedValue({
        ...mockTenant,
        status: "PURGED",
      });

      await expect(service.purgeTenant("tenant-1")).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe("getExportHistory", () => {
    it("should return export events", async () => {
      const { prisma } = await import("@kannan19302/database");
      prisma.tenantLifecycleEvent.findMany.mockResolvedValue([
        { id: "evt-1", eventType: "EXPORT", status: "COMPLETED" },
      ]);

      const result = await service.getExportHistory("tenant-1");

      expect(result).toHaveLength(1);
      expect(prisma.tenantLifecycleEvent.findMany).toHaveBeenCalledWith({
        where: { tenantId: "tenant-1", eventType: "EXPORT" },
        orderBy: { createdAt: "desc" },
        take: 50,
      });
    });
  });
});
