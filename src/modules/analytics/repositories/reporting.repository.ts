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
 * Domain Repository for Scheduled Reports and Report Distribution.
 */
@Injectable()
export class ReportingRepository {
  async findScheduledReports(
    tenantId: string,
    params: PaginationParams = {},
  ): Promise<PaginatedResult<any>> {
    const where: any = { tenantId };
    const { skip, take } = buildPaginationValues(params);
    const orderBy = buildOrderBy(params.sort);

    const [reports, total] = await Promise.all([
      prisma.scheduledReport.findMany({
        where,
        skip,
        take,
        orderBy: orderBy as any,
      }),
      prisma.scheduledReport.count({ where }),
    ]);

    return paginatedResult(reports, total, params);
  }
}
