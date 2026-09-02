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
 * Domain Repository for PWA Push Subscriptions & Mobile Sync States.
 */
@Injectable()
export class PwaRepository {
  async findPushSubscriptions(
    tenantId: string,
    params: PaginationParams = {},
  ): Promise<PaginatedResult<any>> {
    const where: any = { tenantId };
    const { skip, take } = buildPaginationValues(params);
    const orderBy = buildOrderBy(params.sort);

    const [subscriptions, total] = await Promise.all([
      prisma.pwaPushSubscription.findMany({
        where,
        skip,
        take,
        orderBy: orderBy as any,
      }),
      prisma.pwaPushSubscription.count({ where }),
    ]);

    return paginatedResult(subscriptions, total, params);
  }
}
