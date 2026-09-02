import { Injectable } from "@nestjs/common";
import { prisma } from "@kannan19302/database";
import {
  buildPaginationValues,
  buildOrderBy,
  paginatedResult,
  PaginatedResult,
  PaginationParams,
} from "../../../common/utils/pagination.util";

export interface ProjectFilters extends PaginationParams {
  status?: string;
  managerId?: string;
}

export interface TaskFilters extends PaginationParams {
  projectId?: string;
  status?: string;
  assigneeId?: string;
}

/**
 * Domain Repository for Projects, Tasks, Milestones, and Timesheets.
 */
@Injectable()
export class ProjectsRepository {
  // ─── Projects ──────────────────────────────────────────────────────────

  async findProjects(
    tenantId: string,
    params: ProjectFilters = {},
  ): Promise<PaginatedResult<any>> {
    const where: any = { tenantId };
    if (params.status) where.status = params.status;
    if (params.managerId) where.managerId = params.managerId;
    if (params.search) {
      where.OR = [
        { name: { contains: params.search, mode: "insensitive" } },
        { code: { contains: params.search, mode: "insensitive" } },
      ];
    }

    const { skip, take } = buildPaginationValues(params);
    const orderBy = buildOrderBy(params.sort);

    const [projects, total] = await Promise.all([
      prisma.project.findMany({
        where,
        include: {
          tasks: { take: 5 },
          milestones: true,
        },
        skip,
        take,
        orderBy: orderBy as any,
      }),
      prisma.project.count({ where }),
    ]);

    return paginatedResult(projects, total, params);
  }

  async findProjectById(tenantId: string, id: string): Promise<any | null> {
    return prisma.project.findFirst({
      where: { id, tenantId },
      include: {
        tasks: true,
        milestones: true,
      },
    });
  }

  async createProject(tenantId: string, data: any): Promise<any> {
    return prisma.project.create({
      data: {
        ...data,
        tenantId,
      },
    });
  }

  // ─── Tasks ─────────────────────────────────────────────────────────────

  async findTasks(
    tenantId: string,
    params: TaskFilters = {},
  ): Promise<PaginatedResult<any>> {
    const where: any = { tenantId };
    if (params.projectId) where.projectId = params.projectId;
    if (params.status) where.status = params.status;
    if (params.assigneeId) where.assigneeId = params.assigneeId;

    const { skip, take } = buildPaginationValues(params);
    const orderBy = buildOrderBy(params.sort);

    const [tasks, total] = await Promise.all([
      prisma.task.findMany({
        where,
        skip,
        take,
        orderBy: orderBy as any,
      }),
      prisma.task.count({ where }),
    ]);

    return paginatedResult(tasks, total, params);
  }

  async createTask(tenantId: string, data: any): Promise<any> {
    return prisma.task.create({
      data: {
        ...data,
        tenantId,
      },
    });
  }
}
