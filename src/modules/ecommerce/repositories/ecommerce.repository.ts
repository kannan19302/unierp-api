import { Injectable } from "@nestjs/common";
import { prisma } from "@kannan19302/database";
import {
  buildPaginationValues,
  buildOrderBy,
  paginatedResult,
  PaginatedResult,
  PaginationParams,
} from "../../../common/utils/pagination.util";

export interface StorefrontFilters extends PaginationParams {
  isActive?: boolean;
}

/**
 * Domain Repository for E-Commerce & Storefront Management.
 */
@Injectable()
export class EcommerceRepository {
  async findStorefronts(
    tenantId: string,
    params: StorefrontFilters = {},
  ): Promise<PaginatedResult<any>> {
    const where: any = { tenantId };
    if (params.isActive !== undefined) where.isActive = params.isActive;
    if (params.search) {
      where.name = { contains: params.search, mode: "insensitive" };
    }

    const { skip, take } = buildPaginationValues(params);
    const orderBy = buildOrderBy(params.sort);

    const [configs, total] = await Promise.all([
      prisma.storefrontConfig.findMany({
        where,
        skip,
        take,
        orderBy: orderBy as any,
      }),
      prisma.storefrontConfig.count({ where }),
    ]);

    return paginatedResult(configs, total, params);
  }

  async findCategories(tenantId: string, params: PaginationParams = {}): Promise<PaginatedResult<any>> {
    const where: any = { tenantId };
    const { skip, take } = buildPaginationValues(params);
    const orderBy = buildOrderBy(params.sort);

    const [categories, total] = await Promise.all([
      prisma.storefrontCategory.findMany({
        where,
        skip,
        take,
        orderBy: orderBy as any,
      }),
      prisma.storefrontCategory.count({ where }),
    ]);

    return paginatedResult(categories, total, params);
  }
}
