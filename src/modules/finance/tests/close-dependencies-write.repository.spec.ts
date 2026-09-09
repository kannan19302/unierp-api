import { beforeEach, describe, expect, it, vi } from "vitest";
const database = vi.hoisted(() => ({ $transaction: vi.fn() }));
vi.mock("@kannan19302/database", () => ({ prisma: database }));
import { AdvancedFinanceRepository } from "../repositories/advanced-finance.repository";
import { OutboxService } from "../../../common/outbox";

describe("Close dependency write boundary (isolated transaction collaborator)", () => {
  const input = { taskId: "after", dependsOnTaskId: "before", dependencyType: "FINISH_TO_START", lagDays: 0 };
  const row = { id: "dependency", tenantId: "tenant-a", ...input, isCritical: false };
  const tx = {
    $executeRaw: vi.fn(), $queryRaw: vi.fn(),
    closeTaskDependency: { findFirst: vi.fn(), create: vi.fn(), delete: vi.fn() },
  };
  const outbox = new OutboxService();
  const writeEvent = vi.spyOn(outbox, "writeEvent");
  const repository = new AdvancedFinanceRepository(outbox);

  beforeEach(() => {
    vi.resetAllMocks();
    database.$transaction.mockImplementation((operation) => operation(tx));
    tx.$executeRaw.mockResolvedValue(1);
    tx.$queryRaw.mockResolvedValueOnce([{ id: "after" }, { id: "before" }]).mockResolvedValueOnce([{ cycle: false }]);
    tx.closeTaskDependency.findFirst.mockResolvedValue(null);
    tx.closeTaskDependency.create.mockResolvedValue(row);
    writeEvent.mockResolvedValue({ eventId: "event", eventKey: "key" });
  });

  it("uses the transaction for tenant setup, row locks, creation and the versioned event", async () => {
    expect(await repository.createCloseTaskDependency("tenant-a", input)).toEqual(row);
    const [setup, lock] = tx.$executeRaw.mock.calls;
    expect(setup[0].join("?")).toContain("set_config('app.current_tenant_id'");
    expect(setup[1]).toBe("tenant-a");
    expect(lock[1]).toBe("finance.close.dependencies:tenant-a");
    expect(tx.$queryRaw.mock.calls[0][0].join("?")).toContain("FOR SHARE");
    expect(tx.$queryRaw.mock.calls[0].slice(1)).toEqual(["tenant-a", "after", "before"]);
    expect(tx.$queryRaw.mock.calls[1].slice(1)).toEqual(["before", "tenant-a", "after"]);
    expect(tx.closeTaskDependency.findFirst).toHaveBeenCalledWith({
      where: { tenantId: "tenant-a", taskId: "after", dependsOnTaskId: "before" }, select: { id: true },
    });
    expect(tx.closeTaskDependency.create).toHaveBeenCalledWith({ data: { tenantId: "tenant-a", ...input, isCritical: false } });
    expect(writeEvent).toHaveBeenCalledWith(tx, expect.objectContaining({
      tenantId: "tenant-a", eventName: "finance.close.dependency.created", eventVersion: 1,
      aggregateId: "dependency", payload: { dependencyId: "dependency", ...input, isCritical: false },
    }));
  });

  it("rejects missing tenant context before executing SQL", async () => {
    await expect(repository.createCloseTaskDependency(" ", input)).rejects.toThrow("Tenant context is required");
    expect(tx.$executeRaw).not.toHaveBeenCalled();
    expect(tx.closeTaskDependency.create).not.toHaveBeenCalled();
  });

  it("rejects self dependencies before opening a transaction", async () => {
    await expect(repository.createCloseTaskDependency("tenant-a", { ...input, dependsOnTaskId: "after" }))
      .rejects.toThrow("itself");
    expect(database.$transaction).not.toHaveBeenCalled();
  });

  it("rejects missing or invisible tasks without persisting an edge or event", async () => {
    tx.$queryRaw.mockReset().mockResolvedValue([{ id: "after" }]);
    await expect(repository.createCloseTaskDependency("tenant-a", input)).rejects.toThrow("Close tasks not found");
    expect(tx.closeTaskDependency.create).not.toHaveBeenCalled();
    expect(writeEvent).not.toHaveBeenCalled();
  });

  it("rejects duplicate edges", async () => {
    tx.closeTaskDependency.findFirst.mockResolvedValue({ id: "existing" });
    await expect(repository.createCloseTaskDependency("tenant-a", input)).rejects.toThrow("already exists");
    expect(tx.closeTaskDependency.create).not.toHaveBeenCalled();
    expect(writeEvent).not.toHaveBeenCalled();
  });

  it("rejects cycles before writing", async () => {
    tx.$queryRaw.mockReset().mockResolvedValueOnce([{ id: "after" }, { id: "before" }]).mockResolvedValueOnce([{ cycle: true }]);
    await expect(repository.createCloseTaskDependency("tenant-a", input)).rejects.toThrow("cycle");
    expect(tx.closeTaskDependency.create).not.toHaveBeenCalled();
    expect(writeEvent).not.toHaveBeenCalled();
  });

  it("propagates outbox failure to the enclosing transaction", async () => {
    writeEvent.mockRejectedValue(new Error("outbox unavailable"));
    await expect(repository.createCloseTaskDependency("tenant-a", input)).rejects.toThrow("outbox unavailable");
    // This proves rejection propagation, not PostgreSQL rollback.
    expect(writeEvent.mock.calls[0][0]).toBe(tx);
  });

  it("removes a tenant-owned edge and records its full prior payload in the same transaction", async () => {
    tx.closeTaskDependency.findFirst.mockResolvedValue(row);
    expect(await repository.deleteCloseTaskDependency("tenant-a", "dependency")).toEqual({ success: true });
    expect(tx.closeTaskDependency.findFirst).toHaveBeenCalledWith({ where: { tenantId: "tenant-a", id: "dependency" } });
    expect(tx.closeTaskDependency.delete).toHaveBeenCalledWith({ where: { id: "dependency", tenantId: "tenant-a" } });
    expect(writeEvent).toHaveBeenCalledWith(tx, expect.objectContaining({ eventName: "finance.close.dependency.deleted", eventVersion: 1 }));
  });

  it("does not remove an inaccessible edge or publish an event", async () => {
    await expect(repository.deleteCloseTaskDependency("tenant-a", "missing")).rejects.toThrow("not found");
    expect(tx.closeTaskDependency.delete).not.toHaveBeenCalled();
    expect(writeEvent).not.toHaveBeenCalled();
  });
});
