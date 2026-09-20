import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHash } from "crypto";
import { ControlPlaneAuditService, type AuditRecordInput } from "./control-plane-audit.service";

const mockAuditLogs: any[] = [];

vi.mock("@kannan19302/database", () => ({
  prisma: {
    controlPlaneAuditLog: {
      findFirst: vi.fn(async ({ where, orderBy }: any) => {
        const matching = mockAuditLogs
          .filter((l) => !where?.actorId || l.actorId === where.actorId)
          .sort((a, b) => (b.sequenceNum || 0) - (a.sequenceNum || 0));
        return matching[0] || null;
      }),
      findMany: vi.fn(async ({ where, skip = 0, take = 25, orderBy }: any) => {
        let list = [...mockAuditLogs];
        if (where?.actorId) {
          list = list.filter((l) => l.actorId === where.actorId);
        }
        if (where?.action?.contains) {
          list = list.filter((l) => l.action.includes(where.action.contains));
        }
        if (orderBy?.sequenceNum === "asc") {
          list.sort((a, b) => (a.sequenceNum || 0) - (b.sequenceNum || 0));
        }
        return list.slice(skip, skip + take);
      }),
      create: vi.fn(async ({ data }: any) => {
        const item = {
          id: `audit-${mockAuditLogs.length + 1}`,
          sequenceNum: mockAuditLogs.length + 1,
          createdAt: new Date(),
          ...data,
        };
        mockAuditLogs.push(item);
        return item;
      }),
      count: vi.fn(async ({ where }: any = {}) => {
        let list = [...mockAuditLogs];
        if (where?.action?.contains) {
          list = list.filter((l) => l.action.includes(where.action.contains));
        }
        return list.length;
      }),
      groupBy: vi.fn(async () => {
        const unique = Array.from(new Set(mockAuditLogs.map((l) => l.actorId)));
        return unique.map((actorId) => ({ actorId }));
      }),
    },
  },
}));

describe("ControlPlaneAuditService (EC-8.3)", () => {
  let service: ControlPlaneAuditService;

  beforeEach(() => {
    mockAuditLogs.length = 0;
    service = new ControlPlaneAuditService();
  });

  it("records an initial mutation audit entry with empty previousHash and valid contentHash", async () => {
    const input: AuditRecordInput = {
      actorId: "admin-1",
      actorRole: "SUPER_ADMIN",
      action: "tenant.provision",
      targetId: "tenant-acme",
      details: { name: "Acme Corp", tier: "ENTERPRISE" },
    };

    const id = await service.record(input);
    expect(id).toBe("audit-1");
    expect(mockAuditLogs).toHaveLength(1);

    const record = mockAuditLogs[0];
    expect(record.previousHash).toBe("");
    expect(record.action).toBe("tenant.provision");
    expect(record.actorId).toBe("admin-1");

    // Verify SHA-256 calculation
    const rawContent = [
      input.action,
      input.actorId,
      input.targetId,
      JSON.stringify(input.details),
      "",
    ].join("|");
    const expectedHash = createHash("sha256").update(rawContent).digest("hex");
    expect(record.contentHash).toBe(expectedHash);
  });

  it("chains previousHash across multiple mutations by the same actor", async () => {
    await service.record({
      actorId: "admin-1",
      actorRole: "SUPER_ADMIN",
      action: "tenant.provision",
      targetId: "tenant-acme",
      details: { step: 1 },
    });

    const firstHash = mockAuditLogs[0].contentHash;

    await service.record({
      actorId: "admin-1",
      actorRole: "SUPER_ADMIN",
      action: "tenant.suspend",
      targetId: "tenant-acme",
      details: { reason: "payment_failure" },
    });

    expect(mockAuditLogs).toHaveLength(2);
    expect(mockAuditLogs[1].previousHash).toBe(firstHash);

    // Verify the chain integrity with verifyChain
    const verify = await service.verifyChain("admin-1");
    expect(verify.verified).toBe(2);
    expect(verify.brokenAt).toBeUndefined();
  });

  it("detects tampering when an audit entry in the hash chain is modified", async () => {
    await service.record({
      actorId: "admin-1",
      actorRole: "SUPER_ADMIN",
      action: "role.assign",
      targetId: "user-1",
      details: { role: "ADMIN" },
    });

    await service.record({
      actorId: "admin-1",
      actorRole: "SUPER_ADMIN",
      action: "role.assign",
      targetId: "user-2",
      details: { role: "USER" },
    });

    // Tamper with record 0
    mockAuditLogs[0].details = { role: "SUPER_ADMIN_TAMPERED" };

    const verify = await service.verifyChain("admin-1");
    expect(verify.brokenAt).toBe(0);
    expect(verify.verified).toBe(0);
  });

  it("queries records and stats with pagination and filtering", async () => {
    await service.record({
      actorId: "admin-1",
      actorRole: "SUPER_ADMIN",
      action: "tenant.create",
      details: {},
    });
    await service.record({
      actorId: "admin-2",
      actorRole: "OPERATOR",
      action: "canary.deploy",
      details: {},
    });

    const queryResult = await service.queryRecords({ page: 1, pageSize: 10, action: "tenant" });
    expect(queryResult.total).toBe(1);
    expect(queryResult.data[0].action).toBe("tenant.create");

    const stats = await service.getStats();
    expect(stats.totalRecords).toBe(2);
    expect(stats.uniqueActorsCount).toBe(2);
    expect(stats.chainIntegrityStatus).toBe("VERIFIED");
  });
});
