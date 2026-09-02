import { Injectable } from "@nestjs/common";
import { prisma } from "@kannan19302/database";
import {
  buildPaginationValues,
  buildOrderBy,
  paginatedResult,
  PaginatedResult,
  PaginationParams,
} from "../../../common/utils/pagination.util";

export interface MessageFilters extends PaginationParams {
  channelId?: string;
  senderId?: string;
}

/**
 * Domain Repository for Internal Team Communication & Chat Channels.
 */
@Injectable()
export class CommunicationRepository {
  async findMessages(
    tenantId: string,
    params: MessageFilters = {},
  ): Promise<PaginatedResult<any>> {
    const where: any = { tenantId };
    if (params.channelId) where.channelId = params.channelId;
    if (params.senderId) where.senderId = params.senderId;

    const { skip, take } = buildPaginationValues(params);
    const orderBy = buildOrderBy(params.sort);

    const [messages, total] = await Promise.all([
      prisma.message.findMany({
        where,
        skip,
        take,
        orderBy: orderBy as any,
      }),
      prisma.message.count({ where }),
    ]);

    return paginatedResult(messages, total, params);
  }

  async createMessage(tenantId: string, data: any): Promise<any> {
    return prisma.message.create({
      data: {
        ...data,
        tenantId,
      },
    });
  }
}
