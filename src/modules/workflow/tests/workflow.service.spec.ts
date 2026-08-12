import { describe, it, expect, vi, beforeEach } from "vitest";
import { WorkflowService } from "../workflow.service";
import { prisma } from "@kannan19302/database";
import { idpClient as idpPrisma } from "@/common/idp-client";

vi.mock("@kannan19302/database", () => ({
  prisma: {
    workflowDefinition: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    workflowDefinitionStep: {
      create: vi.fn(),
      findFirst: vi.fn(),
      delete: vi.fn(),
    },
    workflowExecution: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    workflowTask: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    workflowSlaRule: {
      findMany: vi.fn(),
      create: vi.fn(),
      findFirst: vi.fn(),
      delete: vi.fn(),
    },
    workflowEscalationRule: {
      findMany: vi.fn(),
      create: vi.fn(),
      findFirst: vi.fn(),
      delete: vi.fn(),
    },
    workflowAuditLog: { findMany: vi.fn(), create: vi.fn() },
    workflow: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
    workflowStep: { create: vi.fn() },
    approvalChain: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    $transaction: vi.fn((fn: any) =>
      fn({
        workflow: {
          create: vi.fn().mockResolvedValue({ id: "w1" }),
          findUnique: vi.fn().mockResolvedValue({ id: "w1", steps: [] }),
        },
        workflowStep: { create: vi.fn() },
        approvalChain: { create: vi.fn(), update: vi.fn() },
      }),
    ),
  },
}));

describe("WorkflowService", () => {
  let service: WorkflowService;

  beforeEach(() => {
    service = new WorkflowService();
    vi.clearAllMocks();
  });

  it("should get definitions", async () => {
    const mockDefs = [
      { id: "1", name: "Test", steps: [], _count: { executions: 0 } },
    ];
    (prisma.workflowDefinition.findMany as any).mockResolvedValue(mockDefs);
    const result = await service.getDefinitions("t1");
    expect(result).toEqual(mockDefs);
  });

  it("should create definition", async () => {
    (prisma.workflowDefinition.findFirst as any).mockResolvedValue(null);
    const mockDef = { id: "1", name: "Test", slug: "test", tenantId: "t1" };
    (prisma.workflowDefinition.create as any).mockResolvedValue(mockDef);
    const result = await service.createDefinition("t1", {
      name: "Test",
      slug: "test",
    });
    expect(result).toEqual(mockDef);
  });

  it("should throw on duplicate slug", async () => {
    (prisma.workflowDefinition.findFirst as any).mockResolvedValue({ id: "1" });
    await expect(
      service.createDefinition("t1", { name: "Test", slug: "test" }),
    ).rejects.toThrow("already exists");
  });

  it("should get tasks", async () => {
    const mockTasks = [{ id: "1", status: "PENDING", tenantId: "t1" }];
    (prisma.workflowTask.findMany as any).mockResolvedValue(mockTasks);
    const result = await service.getTasks("t1");
    expect(result).toEqual(mockTasks);
  });

  it("should get SLA rules", async () => {
    const mockRules = [{ id: "1", slaLimitHours: 24, tenantId: "t1" }];
    (prisma.workflowSlaRule.findMany as any).mockResolvedValue(mockRules);
    const result = await service.getSlaRules("t1");
    expect(result).toEqual(mockRules);
  });

  describe("checkSlaBreaches — E28: escalation must actually reassign the task, not just log it", () => {
    it("reassigns a breached task's assigneeRole/assigneeId to the escalation target, not merely audit-logging the escalation", async () => {
      const breachedTask = {
        id: "task-1",
        tenantId: "t1",
        instanceId: "inst-1",
        nodeId: "node-1",
        status: "PENDING",
        createdAt: new Date(Date.now() - 48 * 3600 * 1000), // 48h ago
      };
      (prisma.workflowTask.findMany as any).mockResolvedValue([breachedTask]);
      (prisma.workflowSlaRule.findMany as any).mockResolvedValue([
        { id: "sla-1", nodeId: "node-1", slaLimitHours: 24, severity: "HIGH" },
      ]);
      (prisma.workflowEscalationRule.findMany as any).mockResolvedValue([
        {
          id: "esc-1",
          slaRuleId: "sla-1",
          escalateToRole: "MANAGER",
          escalateToUser: "user-mgr-1",
        },
      ]);
      (prisma.workflowAuditLog.create as any).mockResolvedValue({});
      (prisma.workflowTask.update as any).mockResolvedValue({});

      await service.checkSlaBreaches("t1");

      expect(prisma.workflowTask.update).toHaveBeenCalledWith({
        where: { id: "task-1" },
        data: { assigneeRole: "MANAGER", assigneeId: "user-mgr-1" },
      });
    });
  });
});
