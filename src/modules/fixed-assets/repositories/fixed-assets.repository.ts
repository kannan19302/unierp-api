import { Injectable } from "@nestjs/common";
import { prisma } from "@kannan19302/database";
import {
  buildPaginationValues,
  buildOrderBy,
  paginatedResult,
  PaginatedResult,
  PaginationParams,
} from "../../../common/utils/pagination.util";

export interface AssetFilters extends PaginationParams {
  status?: string;
  category?: string;
}

/**
 * Domain Repository for Fixed Assets & Asset Lifecycle.
 */
@Injectable()
export class FixedAssetsRepository {
  async findAssets(
    tenantId: string,
    params: AssetFilters = {},
  ): Promise<PaginatedResult<any>> {
    const where: any = { tenantId };
    if (params.status) where.status = params.status;
    if (params.category) where.category = params.category;
    if (params.search) {
      where.OR = [
        { name: { contains: params.search, mode: "insensitive" } },
        { assetNumber: { contains: params.search, mode: "insensitive" } },
      ];
    }

    const { skip, take } = buildPaginationValues(params);
    const orderBy = buildOrderBy(params.sort);

    const [assets, total] = await Promise.all([
      prisma.fixedAsset.findMany({
        where,
        skip,
        take,
        orderBy: orderBy as any,
      }),
      prisma.fixedAsset.count({ where }),
    ]);

    return paginatedResult(assets, total, params);
  }

  async findAssetById(tenantId: string, id: string): Promise<any | null> {
    return prisma.fixedAsset.findFirst({
      where: { id, tenantId },
    });
  }

  async createAsset(tenantId: string, data: any): Promise<any> {
    return prisma.fixedAsset.create({
      data: {
        ...data,
        tenantId,
      },
    });
  }
}
