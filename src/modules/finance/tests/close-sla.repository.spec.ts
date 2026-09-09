import { beforeEach, describe, expect, it, vi } from "vitest";
const database = vi.hoisted(() => ({ $transaction: vi.fn(), closeSlaPolicy: { findMany: vi.fn(), count: vi.fn() } }));
vi.mock("@kannan19302/database", () => ({ prisma: database }));
import { OutboxService } from "../../../common/outbox";
import { CloseSlaRepository } from "../repositories/close-sla.repository";

describe("Close SLA repository transaction boundary", () => {
  const tx = {
    $executeRaw: vi.fn(),
    closeSlaPolicy: { create: vi.fn(), findFirst: vi.fn(), updateMany: vi.fn() },
    closeSlaPolicyVersion: { create: vi.fn(), findFirst: vi.fn() },
    closeEscalationRule: { count: vi.fn() },
    closeTask: { findFirst: vi.fn() },
    closeTaskSla: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
  };
  const outbox = new OutboxService();
  const writeEvent = vi.spyOn(outbox, "writeEvent");
  const repository = new CloseSlaRepository(outbox);
  const policyInput = {
    name: "Close approval", taskType: "APPROVAL", priority: "HIGH", timeBasis: "ELAPSED" as const,
    responseTimeMs: 60_000, resolutionTimeMs: 120_000, escalationRuleIds: ["rule-a"],
  };

  beforeEach(() => {
    vi.resetAllMocks();
    database.$transaction.mockImplementation((operation) => operation(tx));
    tx.$executeRaw.mockResolvedValue(1);
    tx.closeEscalationRule.count.mockResolvedValue(1);
    tx.closeSlaPolicy.create.mockResolvedValue({ id: "policy-a", tenantId: "tenant-a", currentVersion: 1 });
    tx.closeSlaPolicyVersion.create.mockResolvedValue({ id: "version-a", policyId: "policy-a", version: 1,
      responseTimeMs: 60_000n, resolutionTimeMs: 120_000n });
    writeEvent.mockResolvedValue({ eventId: "event-a", eventKey: "key-a" });
  });

  it("creates policy identity, immutable first version and event in one transaction", async () => {
    const result = await repository.createPolicy("tenant-a", "user-a", policyInput);
    expect(tx.closeEscalationRule.count).toHaveBeenCalledWith({ where: { tenantId: "tenant-a", id: { in: ["rule-a"] } } });
    expect(tx.closeSlaPolicy.create).toHaveBeenCalledWith({ data: {
      tenantId: "tenant-a", createdBy: "user-a", updatedBy: "user-a",
    } });
    expect(tx.closeSlaPolicyVersion.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      tenantId: "tenant-a", policyId: "policy-a", version: 1,
      responseTimeMs: 60_000n, resolutionTimeMs: 120_000n,
    }) }));
    expect(writeEvent).toHaveBeenCalledWith(tx, expect.objectContaining({
      eventName: "finance.close.sla.policy.version.created", aggregateId: "policy-a",
    }));
    expect(result.version.id).toBe("version-a");
    expect(result.version.responseTimeMs).toBe(60_000);
  });

  it("rejects an inaccessible escalation rule before creating a version or event", async () => {
    tx.closeEscalationRule.count.mockResolvedValue(0);
    await expect(repository.createPolicy("tenant-a", "user-a", policyInput)).rejects.toThrow("not found");
    expect(tx.closeSlaPolicyVersion.create).not.toHaveBeenCalled();
    expect(writeEvent).not.toHaveBeenCalled();
  });

  it("rejects a stale revision before mutation", async () => {
    tx.closeSlaPolicy.findFirst.mockResolvedValue({ id: "policy-a", status: "ACTIVE", currentVersion: 2 });
    await expect(repository.revisePolicy("tenant-a", "user-a", "policy-a", { ...policyInput, expectedVersion: 1 }))
      .rejects.toThrow("stale");
    expect(tx.closeSlaPolicyVersion.create).not.toHaveBeenCalled();
    expect(tx.closeSlaPolicy.updateMany).not.toHaveBeenCalled();
  });

  it("atomically advances the expected revision version", async () => {
    tx.closeSlaPolicy.findFirst.mockResolvedValue({ id: "policy-a", status: "ACTIVE", currentVersion: 2, updatedBy: "user-old" });
    tx.closeSlaPolicyVersion.create.mockResolvedValue({ id: "version-c", policyId: "policy-a", version: 3,
      responseTimeMs: 60_000n, resolutionTimeMs: 120_000n });
    tx.closeSlaPolicy.updateMany.mockResolvedValue({ count: 1 });
    const result = await repository.revisePolicy("tenant-a", "user-a", "policy-a", { ...policyInput, expectedVersion: 2 });
    expect(tx.closeSlaPolicy.updateMany).toHaveBeenCalledWith({
      where: { tenantId: "tenant-a", id: "policy-a", currentVersion: 2, status: "ACTIVE" },
      data: { currentVersion: 3, updatedBy: "user-a" },
    });
    expect(result.currentVersion).toBe(3);
    expect(writeEvent).toHaveBeenCalledWith(tx, expect.objectContaining({
      payload: { policyId: "policy-a", policyVersionId: "version-c", policyVersion: 3 },
    }));
  });

  it("rolls back a version insert when the guarded policy update loses a race", async () => {
    tx.closeSlaPolicy.findFirst.mockResolvedValue({ id: "policy-a", status: "ACTIVE", currentVersion: 2 });
    tx.closeSlaPolicy.updateMany.mockResolvedValue({ count: 0 });
    await expect(repository.revisePolicy("tenant-a", "user-a", "policy-a", { ...policyInput, expectedVersion: 2 }))
      .rejects.toThrow("concurrently");
    expect(writeEvent).not.toHaveBeenCalled();
  });

  it("retires only the expected active policy version and emits an atomic lifecycle event", async () => {
    tx.closeSlaPolicy.findFirst.mockResolvedValue({ id: "policy-a", status: "ACTIVE", currentVersion: 2 });
    tx.closeSlaPolicy.updateMany.mockResolvedValue({ count: 1 });
    const result = await repository.retirePolicy("tenant-a", "user-a", "policy-a", { expectedVersion: 2 });
    expect(tx.closeSlaPolicy.updateMany).toHaveBeenCalledWith({
      where: { tenantId: "tenant-a", id: "policy-a", currentVersion: 2, status: "ACTIVE" },
      data: { status: "RETIRED", updatedBy: "user-a" },
    });
    expect(writeEvent).toHaveBeenCalledWith(tx, expect.objectContaining({
      eventName: "finance.close.sla.policy.retired",
      payload: { policyId: "policy-a", lastVersion: 2, retiredBy: "user-a" },
    }));
    expect(result.status).toBe("RETIRED");
  });

  it("does not emit a second event when retiring an already retired policy", async () => {
    tx.closeSlaPolicy.findFirst.mockResolvedValue({ id: "policy-a", status: "RETIRED", currentVersion: 2 });
    await expect(repository.retirePolicy("tenant-a", "user-a", "policy-a", { expectedVersion: 1 }))
      .resolves.toMatchObject({ status: "RETIRED" });
    expect(tx.closeSlaPolicy.updateMany).not.toHaveBeenCalled();
    expect(writeEvent).not.toHaveBeenCalled();
  });

  it("assigns a policy snapshot to a tenant-owned task and writes the event in the transaction", async () => {
    tx.closeTaskSla.findFirst.mockResolvedValue(null);
    tx.closeTask.findFirst.mockResolvedValue({ id: "task-a" });
    tx.closeSlaPolicyVersion.findFirst.mockResolvedValue({
      id: "version-a", responseTimeMs: 60_000n, resolutionTimeMs: 120_000n,
      priority: "HIGH", policy: { status: "ACTIVE" },
    });
    tx.closeTaskSla.create.mockImplementation(({ data }) => Promise.resolve({ id: "sla-a", ...data }));
    const input = { mode: "POLICY" as const, taskId: "task-a", policyVersionId: "version-a",
      startedAt: "2026-09-09T09:00:00+05:30", idempotencyKey: "00000000-0000-4000-8000-000000000001" };
    const result = await repository.assignTaskSla("tenant-a", input);
    expect(tx.closeTask.findFirst).toHaveBeenCalledWith({ where: { tenantId: "tenant-a", id: "task-a" }, select: { id: true } });
    expect(tx.closeTaskSla.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      tenantId: "tenant-a", taskId: "task-a", policyVersionId: "version-a",
      responseTimeMs: 60_000n, resolutionTimeMs: 120_000n, slaMinutes: 2,
    }) });
    expect(writeEvent).toHaveBeenCalledWith(tx, expect.objectContaining({
      eventName: "finance.close.sla.task.assigned", aggregateId: "sla-a",
    }));
    expect(result.id).toBe("sla-a");
  });

  it("returns an identical idempotent assignment and rejects a changed payload", async () => {
    const input = { mode: "MANUAL" as const, taskId: "task-a", priority: "NORMAL",
      startedAt: "2026-09-09T00:00:00Z", deadlineAt: "2026-09-10T00:00:00Z",
      idempotencyKey: "00000000-0000-4000-8000-000000000001" };
    tx.closeTaskSla.findFirst.mockResolvedValue(null);
    tx.closeTask.findFirst.mockResolvedValue({ id: "task-a" });
    tx.closeTaskSla.create.mockImplementation(({ data }) => Promise.resolve({ id: "sla-a", ...data }));
    const first = await repository.assignTaskSla("tenant-a", input);
    // Capture the deterministic fingerprint from the attempted create path.
    const fingerprint = tx.closeTaskSla.create.mock.calls[0]?.[0]?.data?.assignmentFingerprint;
    tx.closeTaskSla.findFirst.mockResolvedValue({ id: "existing", assignmentFingerprint: fingerprint });
    expect((await repository.assignTaskSla("tenant-a", input)).id).toBe("existing");
    tx.closeTaskSla.findFirst.mockResolvedValue({ id: "existing", assignmentFingerprint: "different" });
    await expect(repository.assignTaskSla("tenant-a", input)).rejects.toThrow("different assignment");
    expect(first?.id).toBe("sla-a");
  });

  it("propagates outbox failure so the database transaction can roll back", async () => {
    tx.closeTaskSla.findFirst.mockResolvedValue(null);
    tx.closeTask.findFirst.mockResolvedValue({ id: "task-a" });
    tx.closeSlaPolicyVersion.findFirst.mockResolvedValue({
      id: "version-a", responseTimeMs: 1n, resolutionTimeMs: 2n, priority: "NORMAL", policy: { status: "ACTIVE" },
    });
    tx.closeTaskSla.create.mockResolvedValue({ id: "sla-a", taskId: "task-a" });
    writeEvent.mockRejectedValue(new Error("outbox failed"));
    await expect(repository.assignTaskSla("tenant-a", {
      mode: "POLICY", taskId: "task-a", policyVersionId: "version-a", startedAt: "2026-09-09T00:00:00Z",
      idempotencyKey: "00000000-0000-4000-8000-000000000001",
    })).rejects.toThrow("outbox failed");
    expect(writeEvent.mock.calls[0][0]).toBe(tx);
  });

  it("resolves a tenant task SLA through an allowed transition and atomic event", async () => {
    tx.closeTaskSla.findFirst.mockResolvedValue({ id: "sla-a", taskId: "task-a", status: "BREACHED",
      responseTimeMs: 1n, resolutionTimeMs: 2n, breachedAt: new Date() });
    tx.closeTaskSla.update.mockResolvedValue({ id: "sla-a", taskId: "task-a", status: "RESOLVED",
      responseTimeMs: 1n, resolutionTimeMs: 2n });
    const result = await repository.changeTaskSlaStatus("tenant-a", "user-a", "sla-a", "RESOLVED");
    expect(tx.closeTaskSla.update).toHaveBeenCalledWith({
      where: { id: "sla-a", tenantId: "tenant-a" }, data: { status: "RESOLVED" },
    });
    expect(writeEvent).toHaveBeenCalledWith(tx, expect.objectContaining({
      eventName: "finance.close.sla.task.status.changed",
      payload: { taskSlaId: "sla-a", taskId: "task-a", previousStatus: "BREACHED", status: "RESOLVED", changedBy: "user-a" },
    }));
    expect(result.status).toBe("RESOLVED");
  });

  it("rejects reopening a resolved task SLA", async () => {
    tx.closeTaskSla.findFirst.mockResolvedValue({ id: "sla-a", taskId: "task-a", status: "RESOLVED" });
    await expect(repository.changeTaskSlaStatus("tenant-a", "user-a", "sla-a", "ACTIVE"))
      .rejects.toThrow("not allowed");
    expect(tx.closeTaskSla.update).not.toHaveBeenCalled();
    expect(writeEvent).not.toHaveBeenCalled();
  });

  it("bounds policy listing and serializes stored bigint durations", async () => {
    database.closeSlaPolicy.findMany.mockResolvedValue([{ id: "policy-a", versions: [{
      id: "version-a", responseTimeMs: 60_000n, resolutionTimeMs: 120_000n,
    }] }]);
    database.closeSlaPolicy.count.mockResolvedValue(21);
    const result = await repository.listPolicies("tenant-a", { page: 2, limit: 20, status: "ACTIVE" });
    expect(database.closeSlaPolicy.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { tenantId: "tenant-a", status: "ACTIVE" }, skip: 20, take: 20,
    }));
    expect(result).toMatchObject({ total: 21, page: 2, limit: 20, totalPages: 2,
      items: [{ versions: [{ responseTimeMs: 60_000, resolutionTimeMs: 120_000 }] }] });
  });
});
