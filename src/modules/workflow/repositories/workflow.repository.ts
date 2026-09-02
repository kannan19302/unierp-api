import { Injectable } from "@nestjs/common";
import { prisma } from "@kannan19302/database";
import {
  buildPaginationValues,
  buildOrderBy,
  paginatedResult,
  PaginatedResult,
  PaginationParams,
} from "../../../common/utils/pagination.util";

export interface WorkflowDefinitionFilters extends PaginationParams {
  isActive?: boolean;
  triggerType?: string;
}

export interface WorkflowExecutionFilters extends PaginationParams {
  definitionId?: string;
  status?: string;
}

/**
 * Domain Repository for Workflow Automation & Orchestration.
 */
@Injectable()
export class WorkflowRepository {
  // ─── Workflow Definitions ──────────────────────────────────────────────

  async findDefinitions(
    tenantId: string,
    params: WorkflowDefinitionFilters = {},
  ): Promise<PaginatedResult<any>> {
    const where: any = { tenantId };
    if (params.isActive !== undefined) where.isActive = params.isActive;
    if (params.triggerType) where.triggerType = params.triggerType;
    if (params.search) {
      where.OR = [
        { name: { contains: params.search, mode: "insensitive" } },
        { code: { contains: params.search, mode: "insensitive" } },
      ];
    }

    const { skip, take } = buildPaginationValues(params);
    const orderBy = buildOrderBy(params.sort);

    const [definitions, total] = await Promise.all([
      prisma.workflowDefinition.findMany({
        where,
        include: {
          steps: true,
        },
        skip,
        take,
        orderBy: orderBy as any,
      }),
      prisma.workflowDefinition.count({ where }),
    ]);

    return paginatedResult(definitions, total, params);
  }

  async findDefinitionById(tenantId: string, id: string): Promise<any | null> {
    return prisma.workflowDefinition.findFirst({
      where: { id, tenantId },
      include: {
        steps: true,
      },
    });
  }

  async createDefinition(tenantId: string, data: any): Promise<any> {
    return prisma.workflowDefinition.create({
      data: {
        ...data,
        tenantId,
      },
      include: {
        steps: true,
      },
    });
  }

  // ─── Workflow Executions ───────────────────────────────────────────────

  async findExecutions(
    tenantId: string,
    params: WorkflowExecutionFilters = {},
  ): Promise<PaginatedResult<any>> {
    const where: any = { tenantId };
    if (params.definitionId) where.definitionId = params.definitionId;
    if (params.status) where.status = params.status;

    const { skip, take } = buildPaginationValues(params);
    const orderBy = buildOrderBy(params.sort);

    const [executions, total] = await Promise.all([
      prisma.workflowExecution.findMany({
        where,
        skip,
        take,
        orderBy: orderBy as any,
      }),
      prisma.workflowExecution.count({ where }),
    ]);

    return paginatedResult(executions, total, params);
  }
}
