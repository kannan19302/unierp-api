import { Injectable } from "@nestjs/common";
import { prisma } from "@kannan19302/database";
import {
  buildPaginationValues,
  buildOrderBy,
  paginatedResult,
  PaginatedResult,
  PaginationParams,
} from "../../../common/utils/pagination.util";

export interface SubscriptionFilters extends PaginationParams {
  status?: string;
  planId?: string;
}

/**
 * Domain Repository for Subscription Contracts & Metered Billing Cycles.
 */
@Injectable()
export class SubscriptionsRepository {
  async findSubscriptions(
    tenantId: string,
    params: SubscriptionFilters = {},
  ): Promise<PaginatedResult<any>> {
    const where: any = { tenantId };
    if (params.status) where.status = params.status;
    if (params.planId) where.planId = params.planId;

    const { skip, take } = buildPaginationValues(params);
    const orderBy = buildOrderBy(params.sort);

    const [subscriptions, total] = await Promise.all([
      prisma.subscription.findMany({
        where,
        skip,
        take,
        orderBy: orderBy as any,
      }),
      prisma.subscription.count({ where }),
    ]);

    return paginatedResult(subscriptions, total, params);
  }

  async findSubscriptionById(tenantId: string, id: string): Promise<any | null> {
    return prisma.subscription.findFirst({
      where: { id, tenantId },
    });
  }
}
