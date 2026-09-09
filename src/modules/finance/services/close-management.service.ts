import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import { prisma } from "@kannan19302/database";
import { idpClient as idpPrisma } from "../../../common/idp-client";
import { Prisma } from "@kannan19302/database/prisma";
import { AdvancedFinanceRepository } from "../repositories/advanced-finance.repository";
import { CloseSlaRepository } from "../repositories/close-sla.repository";
import type { AssignCloseTaskSlaRequest, CloseSlaPolicyListQuery, CreateCloseSlaPolicyRequest, RetireCloseSlaPolicyRequest, ReviseCloseSlaPolicyRequest } from "@kannan19302/contracts";

@Injectable()
export class CloseManagementService {
  constructor(
    private readonly repository: AdvancedFinanceRepository,
    private readonly closeSlaRepository: CloseSlaRepository,
  ) {}
  // ── Task Dependencies ──────────────────────────────────────────────────────

  async createTaskDependency(
    tenantId: string,
    dto: {
      taskId: string;
      dependsOnTaskId: string;
      dependencyType: string;
      lagDays?: number;
      isCritical?: boolean;
    },
  ) {
    return this.repository.createCloseTaskDependency(tenantId, dto);
  }

  async listTaskDependencies(tenantId: string, taskId?: string) {
    return this.repository.findCloseTaskDependencies(tenantId, taskId);
  }

  async deleteTaskDependency(tenantId: string, id: string) {
    return this.repository.deleteCloseTaskDependency(tenantId, id);
  }

  // ── SLA Management ─────────────────────────────────────────────────────────

  async createCloseSlaPolicy(tenantId: string, actorId: string, dto: CreateCloseSlaPolicyRequest) {
    return this.closeSlaRepository.createPolicy(tenantId, actorId, dto);
  }

  async reviseCloseSlaPolicy(tenantId: string, actorId: string, policyId: string, dto: ReviseCloseSlaPolicyRequest) {
    return this.closeSlaRepository.revisePolicy(tenantId, actorId, policyId, dto);
  }

  async listCloseSlaPolicies(tenantId: string, query: CloseSlaPolicyListQuery) {
    return this.closeSlaRepository.listPolicies(tenantId, query);
  }

  async retireCloseSlaPolicy(tenantId: string, actorId: string, policyId: string, dto: RetireCloseSlaPolicyRequest) {
    return this.closeSlaRepository.retirePolicy(tenantId, actorId, policyId, dto);
  }

  async assignCloseTaskSla(tenantId: string, dto: AssignCloseTaskSlaRequest) {
    return this.closeSlaRepository.assignTaskSla(tenantId, dto);
  }

  async listSlas(
    tenantId: string,
    query: { status?: string; taskId?: string; page?: string; limit?: string },
  ) {
    const page = Math.max(1, parseInt(query.page || "1", 10));
    const limit = Math.min(100, Math.max(1, parseInt(query.limit || "20", 10)));
    const skip = (page - 1) * limit;

    const where: Prisma.CloseTaskSlaWhereInput = { tenantId };
    if (query.status) where.status = query.status;
    if (query.taskId) where.taskId = query.taskId;

    const [items, total] = await Promise.all([
      prisma.closeTaskSla.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
      }),
      prisma.closeTaskSla.count({ where }),
    ]);

    return {
      items: items.map((item) => ({ ...item,
        responseTimeMs: item.responseTimeMs == null ? null : Number(item.responseTimeMs),
        resolutionTimeMs: item.resolutionTimeMs == null ? null : Number(item.resolutionTimeMs),
      })),
      total, page, limit, totalPages: Math.ceil(total / limit),
    };
  }

  async updateSlaStatus(tenantId: string, actorId: string, id: string,
    dto: { status: "ACTIVE" | "BREACHED" | "RESOLVED" }) {
    return this.closeSlaRepository.changeTaskSlaStatus(tenantId, actorId, id, dto.status);
  }

  async getBreachedSlas(tenantId: string) {
    return this.repository.findBreachedCloseTaskSlas(tenantId);
  }

  // ── Close Calendar ─────────────────────────────────────────────────────────

  async createCalendarEvent(
    tenantId: string,
    dto: {
      periodId: string;
      eventType: string;
      title: string;
      description?: string;
      dueAt: string;
    },
  ) {
    return prisma.closeCalendarEvent.create({
      data: {
        tenantId,
        periodId: dto.periodId,
        eventType: dto.eventType,
        title: dto.title,
        description: dto.description || null,
        dueAt: new Date(dto.dueAt),
        status: "PENDING",
      },
    });
  }

  async listCalendarEvents(
    tenantId: string,
    periodId?: string,
    eventType?: string,
  ) {
    const where: Prisma.CloseCalendarEventWhereInput = { tenantId };
    if (periodId) where.periodId = periodId;
    if (eventType) where.eventType = eventType;
    return prisma.closeCalendarEvent.findMany({
      where,
      orderBy: { dueAt: "asc" },
    });
  }

  async completeCalendarEvent(tenantId: string, id: string) {
    const event = await prisma.closeCalendarEvent.findFirst({
      where: { id, tenantId },
    });
    if (!event) throw new NotFoundException("Calendar event not found");
    if (event.status === "COMPLETED") {
      throw new BadRequestException("Event is already completed");
    }
    return prisma.closeCalendarEvent.update({
      where: { id },
      data: { status: "COMPLETED", completedAt: new Date() },
    });
  }

  async getPeriodEvents(tenantId: string, periodId: string) {
    const [pending, completed, total] = await Promise.all([
      prisma.closeCalendarEvent.count({
        where: { tenantId, periodId, status: "PENDING" },
      }),
      prisma.closeCalendarEvent.count({
        where: { tenantId, periodId, status: "COMPLETED" },
      }),
      prisma.closeCalendarEvent.findMany({
        where: { tenantId, periodId },
        orderBy: { dueAt: "asc" },
      }),
    ]);
    return {
      total: total.length,
      pending,
      completed,
      completionRate:
        total.length > 0 ? Math.round((completed / total.length) * 100) : 0,
      events: total,
    };
  }

  // ── Escalation Rules ───────────────────────────────────────────────────────

  async createEscalationRule(
    tenantId: string,
    dto: {
      name: string;
      conditionField: string;
      conditionOperator: string;
      conditionValue: string;
      escalateToRole?: string;
      escalateToUser?: string;
      notifyMethod?: string;
    },
  ) {
    return this.repository.createCloseEscalationRule(tenantId, dto);
  }

  async listEscalationRules(tenantId: string, isActive?: boolean) {
    const where: Prisma.CloseEscalationRuleWhereInput = { tenantId };
    if (isActive !== undefined) where.isActive = isActive;
    return prisma.closeEscalationRule.findMany({
      where,
      orderBy: { createdAt: "desc" },
    });
  }

  async getEscalationRule(tenantId: string, id: string) {
    const rule = await prisma.closeEscalationRule.findFirst({
      where: { id, tenantId },
    });
    if (!rule) throw new NotFoundException("Escalation rule not found");
    return rule;
  }

  async updateEscalationRule(
    tenantId: string,
    id: string,
    dto: {
      name?: string;
      conditionField?: string;
      conditionOperator?: string;
      conditionValue?: string;
      escalateToRole?: string;
      escalateToUser?: string;
      notifyMethod?: string;
      isActive?: boolean;
    },
  ) {
    return this.repository.updateCloseEscalationRule(tenantId, id, dto);
  }

  async deleteEscalationRule(tenantId: string, id: string) {
    return this.repository.retireCloseEscalationRule(tenantId, id);
  }

  // ── Analytics ──────────────────────────────────────────────────────────────

  async captureSnapshot(
    tenantId: string,
    userId: string,
    dto: { periodId: string },
  ) {
    return this.repository.captureCloseAnalyticsSnapshot(tenantId, userId, dto.periodId);
  }

  async getPeriodAnalytics(tenantId: string, periodId: string) {
    const snapshots = await prisma.closeAnalyticsSnapshot.findMany({
      where: { tenantId, periodId },
      orderBy: { capturedAt: "asc" },
    });

    const latest =
      snapshots.length > 0 ? snapshots[snapshots.length - 1] : null;
    const earliest = snapshots.length > 0 ? snapshots[0] : null;

    return {
      periodId,
      snapshotCount: snapshots.length,
      latest: latest
        ? {
            totalTasks: latest.totalTasks,
            completedTasks: latest.completedTasks,
            overdueTasks: latest.overdueTasks,
            breachedSlas: latest.breachedSlas,
            avgCompletion: latest.avgCompletion,
            cycleTimeHours: latest.cycleTimeHours,
            capturedAt: latest.capturedAt,
          }
        : null,
      snapshots,
      improvement:
        latest && earliest
          ? {
              overdueChange: earliest.overdueTasks - latest.overdueTasks,
              completionChange:
                earliest.totalTasks > 0 && latest.totalTasks > 0
                  ? (latest.completedTasks / latest.totalTasks) * 100 -
                    (earliest.completedTasks / earliest.totalTasks) * 100
                  : 0,
            }
          : null,
    };
  }

  async getTrendData(tenantId: string) {
    const snapshots = await prisma.closeAnalyticsSnapshot.findMany({
      where: { tenantId },
      orderBy: { capturedAt: "asc" },
    });

    const groupedByPeriod = snapshots.reduce<
      Record<
        string,
        { capturedAt: Date; completedRate: number; overdueCount: number }[]
      >
    >((acc, s) => {
      const arr = acc[s.periodId] || [];
      arr.push({
        capturedAt: s.capturedAt,
        completedRate:
          s.totalTasks > 0 ? (s.completedTasks / s.totalTasks) * 100 : 0,
        overdueCount: s.overdueTasks,
      });
      acc[s.periodId] = arr;
      return acc;
    }, {});

    return {
      periodCount: Object.keys(groupedByPeriod).length,
      totalSnapshots: snapshots.length,
      byPeriod: groupedByPeriod,
    };
  }

  // ── Dashboard ──────────────────────────────────────────────────────────────

  async getCloseStatusSummary(tenantId: string, periodId?: string) {
    const where: Prisma.CloseTaskWhereInput = { tenantId };
    if (periodId) where.financialPeriodId = periodId;

    const [total, open, inProgress, done, skipped, overdue] = await Promise.all(
      [
        prisma.closeTask.count({ where }),
        prisma.closeTask.count({ where: { ...where, status: "OPEN" } }),
        prisma.closeTask.count({ where: { ...where, status: "IN_PROGRESS" } }),
        prisma.closeTask.count({ where: { ...where, status: "DONE" } }),
        prisma.closeTask.count({ where: { ...where, status: "SKIPPED" } }),
        prisma.closeTask.count({
          where: {
            ...where,
            status: { notIn: ["DONE", "SKIPPED"] },
            dueDate: { lt: new Date() },
          },
        }),
      ],
    );

    const tasksByCategory = await prisma.closeTask.groupBy({
      by: ["category"],
      where,
      _count: true,
    });

    return {
      total,
      open,
      inProgress,
      done,
      skipped,
      overdue,
      completionRate: total > 0 ? Math.round((done / total) * 100) : 0,
      tasksByCategory: tasksByCategory.map((t) => ({
        category: t.category,
        count: t._count,
      })),
    };
  }

  async getCriticalPathAnalysis(tenantId: string, periodId?: string) {
    return this.repository.findCloseCriticalPath(tenantId, periodId);
  }
}
