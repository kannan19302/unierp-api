import { describe, it, expect, vi, beforeEach } from "vitest";
import { SoxComplianceService } from "../services/sox-compliance.service";
import { prisma } from "@kannan19302/database";
import { idpClient as idpPrisma } from "../../../common/idp-client";

vi.mock("@kannan19302/database", () => ({
  prisma: {
    journal: {
      findMany: vi.fn(),
    },
    auditLog: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
  },
}));

vi.mock("../../../common/idp-client", () => ({
  idpClient: {
    user: {
      findMany: vi.fn(),
    },
  },
}));

describe("SoxComplianceService", () => {
  let service: SoxComplianceService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new SoxComplianceService();
  });

  it("returns canonical SOX 404 segregation of duties conflict rules", () => {
    const rules = service.getRules();
    expect(rules.length).toBe(5);
    expect(rules.map((r) => r.ruleId)).toContain("SOD-AP-01");
    expect(rules.map((r) => r.ruleId)).toContain("SOD-GL-01");
    expect(rules.map((r) => r.ruleId)).toContain("SOD-TRS-01");
  });

  it("detects toxic role conflicts when a user possesses incompatible permissions", async () => {
    const mockUsers = [
      {
        id: "usr-1",
        email: "alice@acme.com",
        firstName: "Alice",
        lastName: "Accountant",
        status: "ACTIVE",
        roles: [
          {
            role: {
              name: "Senior Accountant",
              permissions: ["finance.journal.create", "finance.journal.post"],
            },
          },
        ],
      },
      {
        id: "usr-2",
        email: "bob@acme.com",
        firstName: "Bob",
        lastName: "Clerk",
        status: "ACTIVE",
        roles: [
          {
            role: {
              name: "AP Clerk",
              permissions: ["finance.ap.create"],
            },
          },
        ],
      },
    ];

    (idpPrisma.user.findMany as any).mockResolvedValue(mockUsers);

    const conflicts = await service.detectToxicRoleConflicts("t1");
    expect(conflicts.length).toBe(1);
    expect(conflicts[0].userId).toBe("usr-1");
    expect(conflicts[0].ruleId).toBe("SOD-GL-01");
    expect(conflicts[0].severity).toBe("CRITICAL");
    expect(conflicts[0].mitigationStatus).toBe("UNMITIGATED");
  });

  it("audits transactions and flags single-actor journal creations and postings", async () => {
    const mockAuditEvents = [
      {
        entityId: "j-1",
        userId: "usr-rogue",
        action: "CREATE",
        createdAt: new Date(),
      },
      {
        entityId: "j-1",
        userId: "usr-rogue",
        action: "POST",
        createdAt: new Date(),
      },
      {
        entityId: "j-2",
        userId: "usr-maker",
        action: "CREATE",
        createdAt: new Date(),
      },
      {
        entityId: "j-2",
        userId: "usr-checker",
        action: "POST",
        createdAt: new Date(),
      },
    ];

    (prisma.auditLog.findMany as any).mockResolvedValue(mockAuditEvents);

    const violations = await service.auditTransactionViolations("t1");
    expect(violations.length).toBe(1);
    expect(violations[0].actorId).toBe("usr-rogue");
    expect(violations[0].entityRef).toBe("j-1");
  });

  it("calculates comprehensive SOX compliance scorecard and health rating", async () => {
    (idpPrisma.user.findMany as any).mockResolvedValue([]);
    (prisma.auditLog.findMany as any).mockResolvedValue([]);
    (prisma.auditLog.count as any).mockResolvedValue(100);

    const summary = await service.getSoxComplianceSummary("t1");
    expect(summary.overallHealthScore).toBe(100);
    expect(summary.totalConflicts).toBe(0);
    expect(summary.activeRulesCount).toBe(5);
    expect(summary.auditTrailIntegrity).toBe("VERIFIED");
  });
});
