import { beforeEach, describe, expect, it, vi } from "vitest";
const database = vi.hoisted(() => ({
  closeTaskDependency: { findMany: vi.fn() },
  closeTask: { findMany: vi.fn() },
  closeTaskSla: { findMany: vi.fn() },
}));
vi.mock("@kannan19302/database", () => ({ prisma: database }));
import { AdvancedFinanceRepository } from "../repositories/advanced-finance.repository";
import { OutboxService } from "../../../common/outbox";

describe("Close dependency repository query boundary", () => {
  beforeEach(() => vi.clearAllMocks());

  it("resolves both task names only inside the authenticated tenant", async () => {
    database.closeTaskDependency.findMany.mockResolvedValue([
      { id: "dep", tenantId: "tenant-a", taskId: "after", dependsOnTaskId: "before" },
    ]);
    database.closeTask.findMany.mockResolvedValue([
      { id: "after", name: "Close ledger", status: "OPEN" },
      { id: "before", name: "Review journals", status: "DONE" },
    ]);
    const rows = await new AdvancedFinanceRepository(new OutboxService()).findCloseTaskDependencies("tenant-a", "after");
    expect(database.closeTaskDependency.findMany).toHaveBeenCalledWith({
      where: { tenantId: "tenant-a", taskId: "after" }, orderBy: { createdAt: "desc" },
    });
    expect(database.closeTask.findMany).toHaveBeenCalledWith({
      where: { tenantId: "tenant-a", id: { in: ["after", "before"] } },
      select: { id: true, name: true, status: true },
    });
    expect(rows[0]).toMatchObject({ taskName: "Close ledger", dependsOn: "Review journals", status: "OPEN" });
  });

  it("does not query unrelated tasks when no dependencies exist", async () => {
    database.closeTaskDependency.findMany.mockResolvedValue([]);
    expect(await new AdvancedFinanceRepository(new OutboxService()).findCloseTaskDependencies("tenant-a")).toEqual([]);
    expect(database.closeTask.findMany).not.toHaveBeenCalled();
  });

  it("reports unresolved references without inventing task names or completion", async () => {
    database.closeTaskDependency.findMany.mockResolvedValue([
      { id: "dep", taskId: "unavailable", dependsOnTaskId: "missing" },
    ]);
    database.closeTask.findMany.mockResolvedValue([]);
    expect((await new AdvancedFinanceRepository(new OutboxService()).findCloseTaskDependencies("tenant-a"))[0])
      .toMatchObject({ taskName: "Unavailable task", dependsOn: "Unavailable task", status: "UNKNOWN" });
  });
});

describe("Breached close SLA query boundary", () => {
  beforeEach(() => vi.clearAllMocks());
  const repository = new AdvancedFinanceRepository(new OutboxService());

  it("resolves task details with the same tenant filter and deduplicates task IDs", async () => {
    database.closeTaskSla.findMany.mockResolvedValue([
      { id: "sla-a", taskId: "task-a", status: "BREACHED" },
      { id: "sla-b", taskId: "task-a", status: "BREACHED" },
    ]);
    const task = { id: "task-a", name: "Review journal", category: "APPROVAL", assigneeId: null, dueDate: null };
    database.closeTask.findMany.mockResolvedValue([task]);
    const rows = await repository.findBreachedCloseTaskSlas("tenant-a");
    expect(database.closeTaskSla.findMany).toHaveBeenCalledWith({
      where: { tenantId: "tenant-a", status: "BREACHED" }, orderBy: { createdAt: "desc" },
    });
    expect(database.closeTask.findMany).toHaveBeenCalledWith({
      where: { tenantId: "tenant-a", id: { in: ["task-a"] } },
      select: { id: true, name: true, category: true, assigneeId: true, dueDate: true },
    });
    expect(rows).toEqual([
      { id: "sla-a", taskId: "task-a", status: "BREACHED", responseTimeMs: null, resolutionTimeMs: null, task },
      { id: "sla-b", taskId: "task-a", status: "BREACHED", responseTimeMs: null, resolutionTimeMs: null, task },
    ]);
  });

  it("does not look up tasks when there are no breaches", async () => {
    database.closeTaskSla.findMany.mockResolvedValue([]);
    expect(await repository.findBreachedCloseTaskSlas("tenant-a")).toEqual([]);
    expect(database.closeTask.findMany).not.toHaveBeenCalled();
  });

  it("keeps inaccessible task references unresolved", async () => {
    database.closeTaskSla.findMany.mockResolvedValue([{ id: "sla-a", taskId: "unavailable" }]);
    database.closeTask.findMany.mockResolvedValue([]);
    expect(await repository.findBreachedCloseTaskSlas("tenant-a")).toEqual([
      { id: "sla-a", taskId: "unavailable", responseTimeMs: null, resolutionTimeMs: null, task: null },
    ]);
  });
});

describe("Critical close path query boundary", () => {
  beforeEach(() => vi.clearAllMocks());

  it("resolves scalar dependency references with the same tenant and period scope", async () => {
    database.closeTaskDependency.findMany.mockResolvedValue([{ id: "dep-a", taskId: "after", dependsOnTaskId: "before",
      dependencyType: "FINISH_TO_START", lagDays: 0, isCritical: true }]);
    database.closeTask.findMany.mockResolvedValue([
      { id: "after", name: "Post", status: "OPEN" }, { id: "before", name: "Review", status: "OPEN" },
    ]);
    const result = await new AdvancedFinanceRepository(new OutboxService()).findCloseCriticalPath("tenant-a", "period-a");
    expect(database.closeTask.findMany).toHaveBeenCalledWith({
      where: { tenantId: "tenant-a", id: { in: ["after", "before"] }, financialPeriodId: "period-a" },
      select: { id: true, name: true, status: true, dueDate: true, priority: true },
    });
    expect(result).toMatchObject({ criticalDependencies: 1, blockedTasks: 1,
      criticalPath: [{ task: { name: "Post" }, dependsOn: { name: "Review" } }] });
  });
});
