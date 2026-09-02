import { Injectable } from "@nestjs/common";
import { prisma } from "@kannan19302/database";
import {
  buildPaginationValues,
  buildOrderBy,
  paginatedResult,
  PaginatedResult,
  PaginationParams,
} from "../../../common/utils/pagination.util";

export interface HrPolicyFilters extends PaginationParams {
  category?: string;
  status?: string;
}

/**
 * Domain Repository for HR Advanced Policies & Talent Governance.
 */
@Injectable()
export class HrAdvancedRepository {
  async findPolicies(
    tenantId: string,
    params: HrPolicyFilters = {},
  ): Promise<PaginatedResult<any>> {
    const where: any = { tenantId };
    if (params.category) where.category = params.category;
    if (params.status) where.status = params.status;
    if (params.search) {
      where.title = { contains: params.search, mode: "insensitive" };
    }

    const { skip, take } = buildPaginationValues(params);
    const orderBy = buildOrderBy(params.sort);

    const [policies, total] = await Promise.all([
      prisma.hrPolicy.findMany({
        where,
        skip,
        take,
        orderBy: orderBy as any,
      }),
      prisma.hrPolicy.count({ where }),
    ]);

    return paginatedResult(policies, total, params);
  }
}
