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
 * Domain Repository for SaaS Management & Multi-Tenant Provisioning.
 */
@Injectable()
export class SaasRepository {
  async findPlans(params: PaginationParams = {}): Promise<PaginatedResult<any>> {
    const { skip, take } = buildPaginationValues(params);
    const orderBy = buildOrderBy(params.sort);

    const [plans, total] = await Promise.all([
      prisma.saasSubscriptionPlan.findMany({
        skip,
        take,
        orderBy: orderBy as any,
      }),
      prisma.saasSubscriptionPlan.count(),
    ]);

    return paginatedResult(plans, total, params);
  }
}
