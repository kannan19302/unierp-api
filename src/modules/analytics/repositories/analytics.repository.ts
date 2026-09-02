import { Injectable } from "@nestjs/common";
import { prisma } from "@kannan19302/database";
import {
  buildPaginationValues,
  buildOrderBy,
  paginatedResult,
  PaginatedResult,
  PaginationParams,
} from "../../../common/utils/pagination.util";

export interface ReportDefinitionFilters extends PaginationParams {
  category?: string;
  isPublic?: boolean;
}

/**
 * Domain Repository for Analytics Dashboards & Report Definitions.
 */
@Injectable()
export class AnalyticsRepository {
  async findReports(
    tenantId: string,
    params: ReportDefinitionFilters = {},
  ): Promise<PaginatedResult<any>> {
    const where: any = { tenantId };
    if (params.category) where.category = params.category;
    if (params.search) {
      where.name = { contains: params.search, mode: "insensitive" };
    }

    const { skip, take } = buildPaginationValues(params);
    const orderBy = buildOrderBy(params.sort);

    const [reports, total] = await Promise.all([
      prisma.reportDefinition.findMany({
        where,
        skip,
        take,
        orderBy: orderBy as any,
      }),
      prisma.reportDefinition.count({ where }),
    ]);

    return paginatedResult(reports, total, params);
  }

  async findReportById(tenantId: string, id: string): Promise<any | null> {
    return prisma.reportDefinition.findFirst({
      where: { id, tenantId },
    });
  }
}
