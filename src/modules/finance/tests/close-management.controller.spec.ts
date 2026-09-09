import { describe, expect, it, vi } from "vitest";
import { CloseManagementController } from "../controllers/close-management.controller";
import type { CloseManagementService } from "../services/close-management.service";

describe("Close dependency transport adapter", () => {
  const request = { user: { tenantId: "tenant-a" } } as Parameters<CloseManagementController["createTaskDependency"]>[0];
  const input = {
    predecessorTaskId: "task-before",
    successorTaskId: "task-after",
    dependencyType: "FINISH_TO_START",
  };

  it("preserves dependency direction, authenticated tenant and explicit zero lag", async () => {
    const createTaskDependency = vi.fn().mockResolvedValue({ id: "dependency-1" });
    const controller = new CloseManagementController({ createTaskDependency } as unknown as CloseManagementService);
    const response = await controller.createTaskDependency(request, { ...input, lagDays: 0 });
    expect(createTaskDependency).toHaveBeenCalledWith("tenant-a", {
      taskId: "task-after",
      dependsOnTaskId: "task-before",
      dependencyType: "FINISH_TO_START",
      lagDays: 0,
    });
    expect(response).toEqual({ id: "dependency-1" });
  });

  it("does not manufacture an optional lag or forward caller tenant properties", async () => {
    const createTaskDependency = vi.fn().mockResolvedValue({ id: "dependency-2" });
    const controller = new CloseManagementController({ createTaskDependency } as unknown as CloseManagementService);
    const untrustedBody = { ...input, tenantId: "tenant-b", taskId: "other-task" };
    await controller.createTaskDependency(request, untrustedBody);
    expect(createTaskDependency).toHaveBeenCalledWith("tenant-a", {
      taskId: "task-after",
      dependsOnTaskId: "task-before",
      dependencyType: "FINISH_TO_START",
    });
  });

  it("propagates a service failure without claiming successful creation", async () => {
    const failure = new Error("dependency rejected");
    const createTaskDependency = vi.fn().mockRejectedValue(failure);
    const controller = new CloseManagementController({ createTaskDependency } as unknown as CloseManagementService);
    await expect(controller.createTaskDependency(request, input)).rejects.toBe(failure);
  });
});

describe("Close SLA transport contracts", () => {
  const request = { user: { tenantId: "tenant-a", userId: "user-a" } } as Parameters<CloseManagementController["createSla"]>[0];

  it("adapts the legacy hour-based policy request without inventing a task", async () => {
    const createCloseSlaPolicy = vi.fn().mockResolvedValue({ id: "policy-a" });
    const controller = new CloseManagementController({ createCloseSlaPolicy } as unknown as CloseManagementService);
    await controller.createSla(request, {
      name: "Close approval", taskType: "APPROVAL", priority: "HIGH",
      responseTimeHours: 1.5, resolutionTimeHours: 24,
    });
    expect(createCloseSlaPolicy).toHaveBeenCalledWith("tenant-a", "user-a", {
      name: "Close approval", taskType: "APPROVAL", priority: "HIGH", timeBasis: "ELAPSED",
      responseTimeMs: 5_400_000, resolutionTimeMs: 86_400_000, escalationRuleIds: [],
    });
  });

  it("fails legacy escalation blobs explicitly instead of discarding them", async () => {
    const createCloseSlaPolicy = vi.fn();
    const controller = new CloseManagementController({ createCloseSlaPolicy } as unknown as CloseManagementService);
    await expect(controller.createSla(request, {
      name: "Close approval", taskType: "APPROVAL", responseTimeHours: 1, resolutionTimeHours: 24,
      escalationRules: { notify: "finance" },
    })).rejects.toThrow("explicit migration");
    expect(createCloseSlaPolicy).not.toHaveBeenCalled();
  });

  it("passes canonical policy creation and actor identity unchanged", async () => {
    const createCloseSlaPolicy = vi.fn();
    const controller = new CloseManagementController({ createCloseSlaPolicy } as unknown as CloseManagementService);
    const input = { name: "Close approval", taskType: "APPROVAL", priority: "HIGH" as const,
      timeBasis: "ELAPSED" as const, responseTimeMs: 60_000, resolutionTimeMs: 120_000, escalationRuleIds: [] };
    await controller.createCloseSlaPolicy(request, input);
    expect(createCloseSlaPolicy).toHaveBeenCalledWith("tenant-a", "user-a", input);
  });

  it("passes canonical task assignment without caller-controlled tenant or actor fields", async () => {
    const assignCloseTaskSla = vi.fn();
    const controller = new CloseManagementController({ assignCloseTaskSla } as unknown as CloseManagementService);
    const input = { mode: "POLICY" as const, taskId: "task-a", policyVersionId: "version-a",
      startedAt: "2026-09-09T09:00:00+05:30", idempotencyKey: "00000000-0000-4000-8000-000000000001" };
    await controller.assignCloseTaskSla(request, input);
    expect(assignCloseTaskSla).toHaveBeenCalledWith("tenant-a", input);
  });

  it("passes policy retirement with authenticated tenant and actor identity", async () => {
    const retireCloseSlaPolicy = vi.fn();
    const controller = new CloseManagementController({ retireCloseSlaPolicy } as unknown as CloseManagementService);
    await controller.retireCloseSlaPolicy(request, "policy-a", { expectedVersion: 3 });
    expect(retireCloseSlaPolicy).toHaveBeenCalledWith("tenant-a", "user-a", "policy-a", { expectedVersion: 3 });
  });

  it("passes task SLA status changes with authenticated tenant and actor identity", async () => {
    const updateSlaStatus = vi.fn();
    const controller = new CloseManagementController({ updateSlaStatus } as unknown as CloseManagementService);
    await controller.updateSlaStatus(request, "sla-a", { status: "RESOLVED" });
    expect(updateSlaStatus).toHaveBeenCalledWith("tenant-a", "user-a", "sla-a", { status: "RESOLVED" });
  });
});
