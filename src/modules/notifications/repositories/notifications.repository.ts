import { Injectable } from "@nestjs/common";
import { prisma } from "@kannan19302/database";
import {
  buildPaginationValues,
  buildOrderBy,
  paginatedResult,
  PaginatedResult,
  PaginationParams,
} from "../../../common/utils/pagination.util";

export interface NotificationFilters extends PaginationParams {
  userId?: string;
  isRead?: boolean;
}

/**
 * Domain Repository for Push, Email & In-App Notifications.
 */
@Injectable()
export class NotificationsRepository {
  async findNotifications(
    tenantId: string,
    params: NotificationFilters = {},
  ): Promise<PaginatedResult<any>> {
    const where: any = { tenantId };
    if (params.userId) where.userId = params.userId;
    if (params.isRead !== undefined) where.isRead = params.isRead;

    const { skip, take } = buildPaginationValues(params);
    const orderBy = buildOrderBy(params.sort);

    const [notifications, total] = await Promise.all([
      prisma.notification.findMany({
        where,
        skip,
        take,
        orderBy: orderBy as any,
      }),
      prisma.notification.count({ where }),
    ]);

    return paginatedResult(notifications, total, params);
  }

  async createNotification(tenantId: string, data: any): Promise<any> {
    return prisma.notification.create({
      data: {
        ...data,
        tenantId,
      },
    });
  }
}
