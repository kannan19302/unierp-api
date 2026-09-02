import { Injectable } from "@nestjs/common";
import { prisma } from "@kannan19302/database";
import {
  buildPaginationValues,
  buildOrderBy,
  paginatedResult,
  PaginatedResult,
  PaginationParams,
} from "../../../common/utils/pagination.util";

export interface MarketplaceAppFilters extends PaginationParams {
  category?: string;
  isPublished?: boolean;
}

/**
 * Domain Repository for App Marketplace & Ecosystem Extensions.
 */
@Injectable()
export class MarketplaceRepository {
  async findApps(
    tenantId: string,
    params: MarketplaceAppFilters = {},
  ): Promise<PaginatedResult<any>> {
    const where: any = {};
    if (params.category) where.category = params.category;
    if (params.isPublished !== undefined) where.isPublished = params.isPublished;
    if (params.search) {
      where.OR = [
        { name: { contains: params.search, mode: "insensitive" } },
        { slug: { contains: params.search, mode: "insensitive" } },
      ];
    }

    const { skip, take } = buildPaginationValues(params);
    const orderBy = buildOrderBy(params.sort);

    const [apps, total] = await Promise.all([
      prisma.marketplaceApp.findMany({
        where,
        skip,
        take,
        orderBy: orderBy as any,
      }),
      prisma.marketplaceApp.count({ where }),
    ]);

    return paginatedResult(apps, total, params);
  }

  async findAppBySlug(slug: string): Promise<any | null> {
    return prisma.marketplaceApp.findUnique({
      where: { slug },
      include: {
        reviews: { take: 10, orderBy: { createdAt: "desc" } },
      },
    });
  }
}
