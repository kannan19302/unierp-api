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
 * Domain Repository for DevOps Infrastructure & Deployment Pipeline States.
 */
@Injectable()
export class DevopsRepository {
  async findDeployments(params: PaginationParams = {}): Promise<PaginatedResult<any>> {
    const { skip, take } = buildPaginationValues(params);
    const orderBy = buildOrderBy(params.sort);

    const [jobs, total] = await Promise.all([
      prisma.scheduledReport.findMany({
        skip,
        take,
        orderBy: orderBy as any,
      }),
      prisma.scheduledReport.count(),
    ]);

    return paginatedResult(jobs, total, params);
  }
}
