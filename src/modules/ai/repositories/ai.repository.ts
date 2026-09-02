import { Injectable } from "@nestjs/common";
import { prisma } from "@kannan19302/database";
import {
  buildPaginationValues,
  buildOrderBy,
  paginatedResult,
  PaginatedResult,
  PaginationParams,
} from "../../../common/utils/pagination.util";

/**
 * Domain Repository for AI Models, Agent Logs, and Prompt Runs.
 */
@Injectable()
export class AiRepository {
  async findAuditLogs(
    tenantId: string,
    params: PaginationParams = {},
  ): Promise<PaginatedResult<any>> {
    const where: any = { tenantId };
    const { skip, take } = buildPaginationValues(params);
    const orderBy = buildOrderBy(params.sort);

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
