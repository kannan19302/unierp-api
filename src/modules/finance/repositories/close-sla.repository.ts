import { createHash } from "node:crypto";
import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { prisma } from "@kannan19302/database";
import type { Prisma } from "@kannan19302/database/prisma";
import type {
  AssignCloseTaskSlaRequest,
  CreateCloseSlaPolicyRequest,
  ReviseCloseSlaPolicyRequest,
  RetireCloseSlaPolicyRequest,
  CloseSlaPolicyListQuery,
} from "@kannan19302/contracts";
import { OutboxService, type OutboxTxClient } from "../../../common/outbox";

@Injectable()
export class CloseSlaRepository {
  constructor(private readonly outbox: OutboxService) {}

  private async establishTenantAndLock(tx: Prisma.TransactionClient, tenantId: string, key: string) {
    await tx.$executeRaw`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`finance.close.sla:${tenantId}:${key}`}, 0))`;
  }

  private policyVersionForApi<T extends { responseTimeMs: bigint; resolutionTimeMs: bigint }>(version: T) {
    return { ...version, responseTimeMs: Number(version.responseTimeMs), resolutionTimeMs: Number(version.resolutionTimeMs) };
  }

  private taskSlaForApi<T extends { responseTimeMs?: bigint | null; resolutionTimeMs?: bigint | null }>(taskSla: T) {
    return { ...taskSla,
      responseTimeMs: taskSla.responseTimeMs == null ? null : Number(taskSla.responseTimeMs),
      resolutionTimeMs: taskSla.resolutionTimeMs == null ? null : Number(taskSla.resolutionTimeMs),
    };
  }

  async createPolicy(tenantId: string, actorId: string, input: CreateCloseSlaPolicyRequest) {
    return prisma.$transaction(async (tx) => {
      await this.establishTenantAndLock(tx, tenantId, "policies");
      const policy = await tx.closeSlaPolicy.create({ data: {
        tenantId, createdBy: actorId, updatedBy: actorId,
      } });
      const version = await this.createVersionRow(tx, tenantId, actorId, policy.id, 1, input);
      await this.outbox.writeEvent(tx as unknown as OutboxTxClient, {
        tenantId, eventName: "finance.close.sla.policy.version.created", eventVersion: 1,
        aggregateType: "CloseSlaPolicy", aggregateId: policy.id,
        payload: { policyId: policy.id, policyVersionId: version.id, policyVersion: 1 },
      });
      return { ...policy, version: this.policyVersionForApi(version) };
    });
  }

  async revisePolicy(tenantId: string, actorId: string, policyId: string, input: ReviseCloseSlaPolicyRequest) {
    return prisma.$transaction(async (tx) => {
      await this.establishTenantAndLock(tx, tenantId, `policy:${policyId}`);
      const policy = await tx.closeSlaPolicy.findFirst({ where: { tenantId, id: policyId } });
      if (!policy) throw new NotFoundException("Close SLA policy not found");
      if (policy.status !== "ACTIVE") throw new ConflictException("Retired policies cannot be revised");
      if (policy.currentVersion !== input.expectedVersion) throw new ConflictException("Close SLA policy version is stale");
      const nextVersion = policy.currentVersion + 1;
      const version = await this.createVersionRow(tx, tenantId, actorId, policyId, nextVersion, input);
      const changed = await tx.closeSlaPolicy.updateMany({
        where: { tenantId, id: policyId, currentVersion: input.expectedVersion, status: "ACTIVE" },
        data: { currentVersion: nextVersion, updatedBy: actorId },
      });
      if (changed.count !== 1) throw new ConflictException("Close SLA policy changed concurrently");
      await this.outbox.writeEvent(tx as unknown as OutboxTxClient, {
        tenantId, eventName: "finance.close.sla.policy.version.created", eventVersion: 1,
        aggregateType: "CloseSlaPolicy", aggregateId: policyId,
        payload: { policyId, policyVersionId: version.id, policyVersion: nextVersion },
      });
      return { ...policy, currentVersion: nextVersion, updatedBy: actorId,
        version: this.policyVersionForApi(version) };
    });
  }

  private async createVersionRow(tx: Prisma.TransactionClient, tenantId: string, actorId: string,
    policyId: string, version: number, input: CreateCloseSlaPolicyRequest) {
    if (input.escalationRuleIds.length) {
      const count = await tx.closeEscalationRule.count({ where: { tenantId, id: { in: input.escalationRuleIds } } });
      if (count !== input.escalationRuleIds.length) throw new NotFoundException("Close escalation rules not found");
    }
    return tx.closeSlaPolicyVersion.create({ data: {
      tenantId, policyId, version, name: input.name, description: input.description,
      taskType: input.taskType, priority: input.priority, timeBasis: input.timeBasis,
      responseTimeMs: BigInt(input.responseTimeMs), resolutionTimeMs: BigInt(input.resolutionTimeMs),
      createdBy: actorId,
      escalationRules: input.escalationRuleIds.length ? {
        create: input.escalationRuleIds.map((ruleId) => ({ tenantId, ruleId })),
      } : undefined,
    }, include: { escalationRules: true } });
  }

  async listPolicies(tenantId: string, query: CloseSlaPolicyListQuery) {
    const where = { tenantId, ...(query.status ? { status: query.status } : {}) };
    const [policies, total] = await Promise.all([
      prisma.closeSlaPolicy.findMany({
        where, orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
        skip: (query.page - 1) * query.limit, take: query.limit,
        include: { versions: { orderBy: { version: "desc" }, take: 1, include: { escalationRules: true } } },
      }),
      prisma.closeSlaPolicy.count({ where }),
    ]);
    return { items: policies.map((policy) => ({ ...policy,
      versions: policy.versions.map((version) => this.policyVersionForApi(version)),
    })), total, page: query.page, limit: query.limit, totalPages: Math.ceil(total / query.limit) };
  }

  async retirePolicy(tenantId: string, actorId: string, policyId: string, input: RetireCloseSlaPolicyRequest) {
    return prisma.$transaction(async (tx) => {
      await this.establishTenantAndLock(tx, tenantId, `policy:${policyId}`);
      const policy = await tx.closeSlaPolicy.findFirst({ where: { tenantId, id: policyId } });
      if (!policy) throw new NotFoundException("Close SLA policy not found");
      if (policy.status === "RETIRED") return policy;
      if (policy.currentVersion !== input.expectedVersion) throw new ConflictException("Close SLA policy version is stale");
      const changed = await tx.closeSlaPolicy.updateMany({
        where: { tenantId, id: policyId, currentVersion: input.expectedVersion, status: "ACTIVE" },
        data: { status: "RETIRED", updatedBy: actorId },
      });
      if (changed.count !== 1) throw new ConflictException("Close SLA policy changed concurrently");
      await this.outbox.writeEvent(tx as unknown as OutboxTxClient, {
        tenantId, eventName: "finance.close.sla.policy.retired", eventVersion: 1,
        aggregateType: "CloseSlaPolicy", aggregateId: policyId,
        payload: { policyId, lastVersion: policy.currentVersion, retiredBy: actorId },
      });
      return { ...policy, status: "RETIRED", updatedBy: actorId };
    });
  }

  async assignTaskSla(tenantId: string, input: AssignCloseTaskSlaRequest) {
    const canonicalInput = input.mode === "POLICY"
      ? { mode: input.mode, taskId: input.taskId, startedAt: input.startedAt,
          idempotencyKey: input.idempotencyKey, policyVersionId: input.policyVersionId }
      : { mode: input.mode, taskId: input.taskId, startedAt: input.startedAt,
          idempotencyKey: input.idempotencyKey, deadlineAt: input.deadlineAt,
          responseDeadlineAt: input.responseDeadlineAt ?? null, priority: input.priority };
    const fingerprint = createHash("sha256").update(JSON.stringify(canonicalInput)).digest("hex");
    return prisma.$transaction(async (tx) => {
      await this.establishTenantAndLock(tx, tenantId, `task:${input.taskId}`);
      const prior = await tx.closeTaskSla.findFirst({ where: { tenantId, idempotencyKey: input.idempotencyKey } });
      if (prior) {
        if (prior.assignmentFingerprint !== fingerprint) throw new ConflictException("Idempotency key was used for a different assignment");
        return this.taskSlaForApi(prior);
      }
      const task = await tx.closeTask.findFirst({ where: { tenantId, id: input.taskId }, select: { id: true } });
      if (!task) throw new NotFoundException("Close task not found");
      const startedAt = new Date(input.startedAt);
      let policyVersionId: string | null = null;
      let responseTimeMs: number | null = null;
      let resolutionTimeMs: number;
      let responseDeadlineAt: Date | null = null;
      let deadlineAt: Date;
      let priority: string;
      if (input.mode === "POLICY") {
        const version = await tx.closeSlaPolicyVersion.findFirst({
          where: { tenantId, id: input.policyVersionId },
          include: { policy: { select: { status: true } } },
        });
        if (!version || version.policy.status !== "ACTIVE") throw new NotFoundException("Active close SLA policy version not found");
        policyVersionId = version.id;
        responseTimeMs = Number(version.responseTimeMs);
        resolutionTimeMs = Number(version.resolutionTimeMs);
        responseDeadlineAt = new Date(startedAt.getTime() + responseTimeMs);
        deadlineAt = new Date(startedAt.getTime() + resolutionTimeMs);
        priority = version.priority;
      } else {
        deadlineAt = new Date(input.deadlineAt);
        responseDeadlineAt = input.responseDeadlineAt ? new Date(input.responseDeadlineAt) : null;
        resolutionTimeMs = deadlineAt.getTime() - startedAt.getTime();
        responseTimeMs = responseDeadlineAt ? responseDeadlineAt.getTime() - startedAt.getTime() : null;
        priority = input.priority;
      }
      const taskSla = await tx.closeTaskSla.create({ data: {
        tenantId, taskId: input.taskId, policyVersionId, startedAt, responseDeadlineAt, deadlineAt,
        responseTimeMs: responseTimeMs === null ? null : BigInt(responseTimeMs), resolutionTimeMs: BigInt(resolutionTimeMs),
        slaMinutes: Math.ceil(resolutionTimeMs / 60_000), priority,
        idempotencyKey: input.idempotencyKey, assignmentFingerprint: fingerprint, status: "ACTIVE",
      } });
      await this.outbox.writeEvent(tx as unknown as OutboxTxClient, {
        tenantId, eventName: "finance.close.sla.task.assigned", eventVersion: 1,
        aggregateType: "CloseTaskSla", aggregateId: taskSla.id,
        payload: { taskSlaId: taskSla.id, taskId: taskSla.taskId, policyVersionId,
          startedAt: startedAt.toISOString(), responseDeadlineAt: responseDeadlineAt?.toISOString() ?? null,
          deadlineAt: deadlineAt.toISOString() },
      });
      return this.taskSlaForApi(taskSla);
    });
  }

  async changeTaskSlaStatus(tenantId: string, actorId: string, id: string,
    status: "ACTIVE" | "BREACHED" | "RESOLVED") {
    return prisma.$transaction(async (tx) => {
      await this.establishTenantAndLock(tx, tenantId, `task-sla:${id}`);
      const sla = await tx.closeTaskSla.findFirst({ where: { tenantId, id } });
      if (!sla) throw new NotFoundException("Task SLA not found");
      if (sla.status === status) return this.taskSlaForApi(sla);
      const transitions: Record<string, string[]> = { ACTIVE: ["BREACHED", "RESOLVED"], BREACHED: ["RESOLVED"] };
      if (!transitions[sla.status]?.includes(status)) throw new ConflictException("Task SLA status transition is not allowed");
      const updated = await tx.closeTaskSla.update({ where: { id, tenantId }, data: {
        status, ...(status === "BREACHED" && !sla.breachedAt ? { breachedAt: new Date() } : {}),
      } });
      await this.outbox.writeEvent(tx as unknown as OutboxTxClient, {
        tenantId, eventName: "finance.close.sla.task.status.changed", eventVersion: 1,
        aggregateType: "CloseTaskSla", aggregateId: id,
        payload: { taskSlaId: id, taskId: sla.taskId, previousStatus: sla.status, status, changedBy: actorId },
      });
      return this.taskSlaForApi(updated);
    });
  }
}
