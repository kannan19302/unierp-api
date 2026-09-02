import { Injectable } from "@nestjs/common";
import { prisma } from "@kannan19302/database";
import {
  buildPaginationValues,
  buildOrderBy,
  paginatedResult,
  PaginatedResult,
  PaginationParams,
} from "../../../common/utils/pagination.util";

export interface AuditLogFilters extends PaginationParams {
  action?: string;
  userId?: string;
}

/**
 * Domain Repository for System Admin & Governance Audit Logs.
 */
@Injectable()
export class AdminRepository {
  async findAuditLogs(
    tenantId: string,
    params: AuditLogFilters = {},
  ): Promise<PaginatedResult<any>> {
    const where: any = { tenantId };
    if (params.action) where.action = params.action;
    if (params.userId) where.userId = params.userId;

    const { skip, take } = buildPaginationValues(params);
    const orderBy = buildOrderBy(params.sort || "-createdAt");

    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        skip,
        take,
        orderBy: orderBy as any,
      }),
      prisma.auditLog.count({ where }),
    ]);

    return paginatedResult(logs, total, params);
  }
}
