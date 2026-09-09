import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { prisma } from "@kannan19302/database";
import { Prisma } from "@kannan19302/database/prisma";
import type { CloseDependencyPayload } from "@kannan19302/contracts";
import { OutboxService, type OutboxTxClient } from "../../../common/outbox";
import {
  buildPaginationValues,
  buildOrderBy,
  paginatedResult,
  PaginatedResult,
  PaginationParams,
} from "../../../common/utils/pagination.util";

export interface TaxRuleFilters extends PaginationParams {
  jurisdiction?: string;
  isActive?: boolean;
}

export interface CloseEscalationRuleInput {
  name: string;
  conditionField: string;
  conditionOperator: string;
  conditionValue: string;
  escalateToRole?: string;
  escalateToUser?: string;
  notifyMethod?: string;
  isActive?: boolean;
}

/**
 * Domain Repository for Advanced Finance, Multi-Currency, and Tax Engines.
 */
@Injectable()
export class AdvancedFinanceRepository {
  constructor(private readonly outbox: OutboxService) {}

  private async lockCloseDependencies(tx: Prisma.TransactionClient, tenantId: string) {
    if (!tenantId.trim()) throw new BadRequestException("Tenant context is required");
    // Raw graph queries do not pass through the Prisma model-query extension.
    await tx.$executeRaw`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`finance.close.dependencies:${tenantId}`}, 0))`;
  }

  private async lockCloseEscalationRules(tx: Prisma.TransactionClient, tenantId: string) {
    if (!tenantId.trim()) throw new BadRequestException("Tenant context is required");
    await tx.$executeRaw`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`finance.close.escalations:${tenantId}`}, 0))`;
  }

  async createCloseEscalationRule(tenantId: string, input: CloseEscalationRuleInput) {
    return prisma.$transaction(async (tx) => {
      await this.lockCloseEscalationRules(tx, tenantId);
      const rule = await tx.closeEscalationRule.create({ data: {
        tenantId, name: input.name, conditionField: input.conditionField,
        conditionOperator: input.conditionOperator, conditionValue: input.conditionValue,
        escalateToRole: input.escalateToRole ?? null, escalateToUser: input.escalateToUser ?? null,
        notifyMethod: input.notifyMethod ?? "EMAIL", isActive: true,
      } });
      await this.writeCloseEscalationEvent(tx, tenantId, rule.id, "created", true);
      return rule;
    });
  }

  async updateCloseEscalationRule(tenantId: string, id: string, input: Partial<CloseEscalationRuleInput>) {
    return prisma.$transaction(async (tx) => {
      await this.lockCloseEscalationRules(tx, tenantId);
      const existing = await tx.closeEscalationRule.findFirst({ where: { tenantId, id } });
      if (!existing) throw new NotFoundException("Escalation rule not found");
      const rule = await tx.closeEscalationRule.update({ where: { id, tenantId }, data: input });
      await this.writeCloseEscalationEvent(tx, tenantId, id, "updated", rule.isActive);
      return rule;
    });
  }

  async retireCloseEscalationRule(tenantId: string, id: string) {
    return prisma.$transaction(async (tx) => {
      await this.lockCloseEscalationRules(tx, tenantId);
      const existing = await tx.closeEscalationRule.findFirst({ where: { tenantId, id } });
      if (!existing) throw new NotFoundException("Escalation rule not found");
      if (!existing.isActive) return { success: true };
      await tx.closeEscalationRule.update({ where: { id, tenantId }, data: { isActive: false } });
      await this.writeCloseEscalationEvent(tx, tenantId, id, "retired", false);
      return { success: true };
    });
  }

  private async writeCloseEscalationEvent(tx: Prisma.TransactionClient, tenantId: string, ruleId: string,
    action: "created" | "updated" | "retired", isActive: boolean) {
    await this.outbox.writeEvent(tx as unknown as OutboxTxClient, {
      tenantId, eventName: "finance.close.escalation-rule.changed", eventVersion: 1,
      aggregateType: "CloseEscalationRule", aggregateId: ruleId,
      payload: { ruleId, action, isActive },
    });
  }

  async captureCloseAnalyticsSnapshot(tenantId: string, actorId: string, periodId: string) {
    return prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`finance.close.snapshot:${tenantId}:${periodId}`}, 0))`;
      const period = await tx.financialPeriod.findFirst({ where: { tenantId, id: periodId }, select: { id: true } });
      if (!period) throw new NotFoundException("Financial period not found");
      const tasks = await tx.closeTask.findMany({
        where: { tenantId, financialPeriodId: periodId },
        select: { id: true, status: true, dueDate: true, createdAt: true, completedAt: true },
      });
      const taskIds = tasks.map((task) => task.id);
      const now = new Date();
      const completed = tasks.filter((task) => task.status === "DONE");
      const overdueTasks = tasks.filter((task) => !["DONE", "SKIPPED"].includes(task.status) && task.dueDate && task.dueDate < now).length;
      const breachedSlas = taskIds.length
        ? await tx.closeTaskSla.count({ where: { tenantId, taskId: { in: taskIds }, status: "BREACHED" } })
        : 0;
      const cycleSamples = completed.flatMap((task) => task.completedAt
        ? [(task.completedAt.getTime() - task.createdAt.getTime()) / 3_600_000] : []);
      const avgCompletion = tasks.length ? (completed.length / tasks.length) * 100 : 0;
      const cycleTimeHours = cycleSamples.length
        ? cycleSamples.reduce((sum, hours) => sum + hours, 0) / cycleSamples.length : null;
      const snapshot = await tx.closeAnalyticsSnapshot.create({ data: {
        tenantId, periodId, totalTasks: tasks.length, completedTasks: completed.length,
        overdueTasks, breachedSlas, avgCompletion: new Prisma.Decimal(avgCompletion),
        cycleTimeHours: cycleTimeHours === null ? null : new Prisma.Decimal(cycleTimeHours),
        snapshotData: { capturedBy: actorId },
      } });
      await this.outbox.writeEvent(tx as unknown as OutboxTxClient, {
        tenantId, eventName: "finance.close.analytics.snapshot.captured", eventVersion: 1,
        aggregateType: "CloseAnalyticsSnapshot", aggregateId: snapshot.id,
        payload: { snapshotId: snapshot.id, periodId, totalTasks: tasks.length,
          completedTasks: completed.length, overdueTasks, breachedSlas },
      });
      return snapshot;
    });
  }

  async findCloseCriticalPath(tenantId: string, periodId?: string) {
    const dependencies = await prisma.closeTaskDependency.findMany({
      where: { tenantId, isCritical: true }, orderBy: { createdAt: "asc" },
    });
    if (!dependencies.length) return { criticalDependencies: 0, blockedTasks: 0, criticalPath: [] };
    const ids = [...new Set(dependencies.flatMap((item) => [item.taskId, item.dependsOnTaskId]))];
    const tasks = await prisma.closeTask.findMany({
      where: { tenantId, id: { in: ids }, ...(periodId ? { financialPeriodId: periodId } : {}) },
      select: { id: true, name: true, status: true, dueDate: true, priority: true },
    });
    const byId = new Map(tasks.map((task) => [task.id, task]));
    const visible = dependencies.filter((item) => byId.has(item.taskId) && byId.has(item.dependsOnTaskId));
    const blockedTasks = new Set(visible
      .filter((item) => !["DONE", "SKIPPED"].includes(byId.get(item.dependsOnTaskId)!.status))
      .map((item) => item.taskId)).size;
    return { criticalDependencies: visible.length, blockedTasks,
      criticalPath: visible.map((item) => ({ ...item, task: byId.get(item.taskId), dependsOn: byId.get(item.dependsOnTaskId) })),
    };
  }

  async createCloseTaskDependency(tenantId: string, input: {
    taskId: string; dependsOnTaskId: string; dependencyType: string;
    lagDays?: number; isCritical?: boolean;
  }) {
    if (input.taskId === input.dependsOnTaskId) {
      throw new BadRequestException("A task cannot depend on itself");
    }
    return prisma.$transaction(async (tx) => {
      await this.lockCloseDependencies(tx, tenantId);
      // Row locks keep validated task references stable until this transaction commits.
      const tasks = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM close_tasks WHERE tenant_id = ${tenantId}
          AND id IN (${input.taskId}, ${input.dependsOnTaskId}) FOR SHARE`;
      if (tasks.length !== 2) throw new NotFoundException("Close tasks not found");
      const existing = await tx.closeTaskDependency.findFirst({
        where: { tenantId, taskId: input.taskId, dependsOnTaskId: input.dependsOnTaskId },
        select: { id: true },
      });
      if (existing) throw new ConflictException("Task dependency already exists");
      const [result] = await tx.$queryRaw<Array<{ cycle: boolean }>>`
        WITH RECURSIVE prerequisites(task_id) AS (
          SELECT ${input.dependsOnTaskId}::text
          UNION
          SELECT d.depends_on_task_id FROM close_task_dependencies d
          JOIN prerequisites p ON d.task_id = p.task_id
          WHERE d.tenant_id = ${tenantId}
        ) SELECT EXISTS (
          SELECT 1 FROM prerequisites WHERE task_id = ${input.taskId}
        ) AS cycle`;
      if (!result || result.cycle) throw new BadRequestException("Task dependency would create a cycle");
      const dependency = await tx.closeTaskDependency.create({ data: {
        tenantId, taskId: input.taskId, dependsOnTaskId: input.dependsOnTaskId,
        dependencyType: input.dependencyType, lagDays: input.lagDays ?? 0,
        isCritical: input.isCritical ?? false,
      } });
      await this.writeCloseDependencyEvent(tx, tenantId, dependency, "created");
      return dependency;
    });
  }

  async deleteCloseTaskDependency(tenantId: string, id: string) {
    return prisma.$transaction(async (tx) => {
      await this.lockCloseDependencies(tx, tenantId);
      const dependency = await tx.closeTaskDependency.findFirst({ where: { tenantId, id } });
      if (!dependency) throw new NotFoundException("Task dependency not found");
      await tx.closeTaskDependency.delete({ where: { id, tenantId } });
      await this.writeCloseDependencyEvent(tx, tenantId, dependency, "deleted");
      return { success: true };
    });
  }

  private async writeCloseDependencyEvent(tx: Prisma.TransactionClient, tenantId: string,
    dependency: { id: string; taskId: string; dependsOnTaskId: string; dependencyType: string; lagDays: number; isCritical: boolean },
    action: "created" | "deleted") {
    const payload: CloseDependencyPayload = {
      dependencyId: dependency.id, taskId: dependency.taskId,
      dependsOnTaskId: dependency.dependsOnTaskId, dependencyType: dependency.dependencyType,
      lagDays: dependency.lagDays, isCritical: dependency.isCritical,
    };
    await this.outbox.writeEvent(tx as unknown as OutboxTxClient, {
      tenantId, eventName: `finance.close.dependency.${action}`, eventVersion: 1,
      aggregateType: "CloseTaskDependency", aggregateId: dependency.id, payload: { ...payload },
    });
  }

  async findCloseTaskDependencies(tenantId: string, taskId?: string) {
    const dependencies = await prisma.closeTaskDependency.findMany({
      where: { tenantId, ...(taskId ? { taskId } : {}) },
      orderBy: { createdAt: "desc" },
    });
    if (dependencies.length === 0) return [];
    const taskIds = [...new Set(dependencies.flatMap((dependency) => [dependency.taskId, dependency.dependsOnTaskId]))];
    const tasks = await prisma.closeTask.findMany({
      where: { tenantId, id: { in: taskIds } },
      select: { id: true, name: true, status: true },
    });
    const byId = new Map(tasks.map((task) => [task.id, task]));
    return dependencies.map((dependency) => ({
      ...dependency,
      taskName: byId.get(dependency.taskId)?.name ?? "Unavailable task",
      dependsOn: byId.get(dependency.dependsOnTaskId)?.name ?? "Unavailable task",
      status: byId.get(dependency.taskId)?.status ?? "UNKNOWN",
    }));
  }

  async findBreachedCloseTaskSlas(tenantId: string) {
    const slas = await prisma.closeTaskSla.findMany({
      where: { tenantId, status: "BREACHED" },
      orderBy: { createdAt: "desc" },
    });
    if (slas.length === 0) return [];
    const taskIds = [...new Set(slas.map((sla) => sla.taskId))];
    const tasks = await prisma.closeTask.findMany({
      where: { tenantId, id: { in: taskIds } },
      select: { id: true, name: true, category: true, assigneeId: true, dueDate: true },
    });
    const byId = new Map(tasks.map((task) => [task.id, task]));
    return slas.map((sla) => ({ ...sla,
      responseTimeMs: sla.responseTimeMs == null ? null : Number(sla.responseTimeMs),
      resolutionTimeMs: sla.resolutionTimeMs == null ? null : Number(sla.resolutionTimeMs),
      task: byId.get(sla.taskId) ?? null,
    }));
  }

  async findTaxRates(
    tenantId: string,
    params: TaxRuleFilters = {},
  ): Promise<PaginatedResult<any>> {
    const where: any = { tenantId };
    if (params.isActive !== undefined) where.isActive = params.isActive;
    if (params.search) {
      where.name = { contains: params.search, mode: "insensitive" };
    }

    const { skip, take } = buildPaginationValues(params);
    const orderBy = buildOrderBy(params.sort);

    const [taxRates, total] = await Promise.all([
      prisma.taxRate.findMany({
        where,
        skip,
        take,
        orderBy: orderBy as any,
      }),
      prisma.taxRate.count({ where }),
    ]);

    return paginatedResult(taxRates, total, params);
  }
}
