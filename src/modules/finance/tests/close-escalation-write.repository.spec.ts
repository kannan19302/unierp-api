import { beforeEach, describe, expect, it, vi } from "vitest";

const database = vi.hoisted(() => ({ $transaction: vi.fn() }));
vi.mock("@kannan19302/database", () => ({ prisma: database }));

import { OutboxService } from "../../../common/outbox";
import { AdvancedFinanceRepository } from "../repositories/advanced-finance.repository";

describe("Close escalation rule write boundary", () => {
  const tx = {
    $executeRaw: vi.fn(),
    closeEscalationRule: { create: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
    financialPeriod: { findFirst: vi.fn() },
    closeTask: { findMany: vi.fn() },
    closeTaskSla: { count: vi.fn() },
    closeAnalyticsSnapshot: { create: vi.fn() },
  };
  const outbox = new OutboxService();
  const writeEvent = vi.spyOn(outbox, "writeEvent");
  const repository = new AdvancedFinanceRepository(outbox);

  beforeEach(() => {
    vi.resetAllMocks();
    database.$transaction.mockImplementation((operation) => operation(tx));
    tx.$executeRaw.mockResolvedValue(1);
    writeEvent.mockResolvedValue({ eventId: "event-a", eventKey: "key-a" });
  });

  it("creates a tenant-scoped rule and its event in one transaction", async () => {
    tx.closeEscalationRule.create.mockResolvedValue({ id: "rule-a", isActive: true });
    await repository.createCloseEscalationRule("tenant-a", {
      name: "Notify controller", conditionField: "status", conditionOperator: "EQUALS",
      conditionValue: "SLA_BREACH", escalateToRole: "FINANCE_CONTROLLER", notifyMethod: "BOTH",
    });
    expect(tx.closeEscalationRule.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      tenantId: "tenant-a", conditionValue: "SLA_BREACH", escalateToRole: "FINANCE_CONTROLLER",
    }) });
    expect(writeEvent).toHaveBeenCalledWith(tx, expect.objectContaining({
      eventName: "finance.close.escalation-rule.changed",
      payload: { ruleId: "rule-a", action: "created", isActive: true },
    }));
  });

  it("updates only a rule visible to the authenticated tenant", async () => {
    tx.closeEscalationRule.findFirst.mockResolvedValue({ id: "rule-a", isActive: true });
    tx.closeEscalationRule.update.mockResolvedValue({ id: "rule-a", isActive: false });
    await repository.updateCloseEscalationRule("tenant-a", "rule-a", { isActive: false });
    expect(tx.closeEscalationRule.findFirst).toHaveBeenCalledWith({ where: { tenantId: "tenant-a", id: "rule-a" } });
    expect(tx.closeEscalationRule.update).toHaveBeenCalledWith({
      where: { id: "rule-a", tenantId: "tenant-a" }, data: { isActive: false },
    });
    expect(writeEvent).toHaveBeenCalledWith(tx, expect.objectContaining({
      payload: { ruleId: "rule-a", action: "updated", isActive: false },
    }));
  });

  it("retires instead of deleting a historically referenced rule", async () => {
    tx.closeEscalationRule.findFirst.mockResolvedValue({ id: "rule-a", isActive: true });
    tx.closeEscalationRule.update.mockResolvedValue({ id: "rule-a", isActive: false });
    await expect(repository.retireCloseEscalationRule("tenant-a", "rule-a")).resolves.toEqual({ success: true });
    expect(tx.closeEscalationRule.update).toHaveBeenCalledWith({
      where: { id: "rule-a", tenantId: "tenant-a" }, data: { isActive: false },
    });
    expect(writeEvent).toHaveBeenCalledWith(tx, expect.objectContaining({
      payload: { ruleId: "rule-a", action: "retired", isActive: false },
    }));
  });

  it("computes snapshot evidence from tenant records instead of client counters", async () => {
    const createdAt = new Date("2026-09-01T00:00:00Z");
    tx.financialPeriod.findFirst.mockResolvedValue({ id: "period-a" });
    tx.closeTask.findMany.mockResolvedValue([
      { id: "task-a", status: "DONE", dueDate: null, createdAt, completedAt: new Date("2026-09-01T02:00:00Z") },
      { id: "task-b", status: "OPEN", dueDate: new Date("2020-01-01T00:00:00Z"), createdAt, completedAt: null },
    ]);
    tx.closeTaskSla.count.mockResolvedValue(1);
    tx.closeAnalyticsSnapshot.create.mockImplementation(({ data }) => Promise.resolve({ id: "snapshot-a", ...data }));
    const result = await repository.captureCloseAnalyticsSnapshot("tenant-a", "user-a", "period-a");
    expect(tx.financialPeriod.findFirst).toHaveBeenCalledWith({
      where: { tenantId: "tenant-a", id: "period-a" }, select: { id: true },
    });
    expect(result).toMatchObject({ totalTasks: 2, completedTasks: 1, overdueTasks: 1, breachedSlas: 1 });
    expect(writeEvent).toHaveBeenCalledWith(tx, expect.objectContaining({
      eventName: "finance.close.analytics.snapshot.captured",
      payload: expect.objectContaining({ snapshotId: "snapshot-a", periodId: "period-a", totalTasks: 2 }),
    }));
  });
});
