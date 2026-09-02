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
 * Domain Repository for Developer Portal, SDK Tokens, and Webhook Subscriptions.
 */
@Injectable()
export class DeveloperRepository {
  async findWebhooks(
    tenantId: string,
    params: PaginationParams = {},
  ): Promise<PaginatedResult<any>> {
    const where: any = { tenantId };
    const { skip, take } = buildPaginationValues(params);
    const orderBy = buildOrderBy(params.sort);

    const [webhooks, total] = await Promise.all([
      prisma.webhookSubscription.findMany({
        where,
        skip,
        take,
        orderBy: orderBy as any,
      }),
      prisma.webhookSubscription.count({ where }),
    ]);

    return paginatedResult(webhooks, total, params);
  }
}
