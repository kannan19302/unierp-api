import { Injectable } from "@nestjs/common";
import { prisma } from "@kannan19302/database";
import {
  buildPaginationValues,
  buildOrderBy,
  paginatedResult,
  PaginatedResult,
  PaginationParams,
} from "../../../common/utils/pagination.util";

export interface SavedViewFilters extends PaginationParams {
  entityType?: string;
  isDefault?: boolean;
}

/**
 * Domain Repository for Saved Views & UI Grid Configurations.
 */
@Injectable()
export class SavedViewsRepository {
  async findSavedViews(
    tenantId: string,
    params: SavedViewFilters = {},
  ): Promise<PaginatedResult<any>> {
    const where: any = { tenantId };
    if (params.entityType) where.entityType = params.entityType;
    if (params.isDefault !== undefined) where.isDefault = params.isDefault;

    const { skip, take } = buildPaginationValues(params);
    const orderBy = buildOrderBy(params.sort);

    const [views, total] = await Promise.all([
      prisma.savedView.findMany({
        where,
        skip,
        take,
        orderBy: orderBy as any,
      }),
      prisma.savedView.count({ where }),
    ]);

    return paginatedResult(views, total, params);
  }

  async createSavedView(tenantId: string, data: any): Promise<any> {
    return prisma.savedView.create({
      data: {
        ...data,
        tenantId,
      },
    });
  }
}
