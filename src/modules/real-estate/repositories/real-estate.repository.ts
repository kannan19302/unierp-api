import { Injectable } from "@nestjs/common";
import { prisma } from "@kannan19302/database";
import {
  buildPaginationValues,
  buildOrderBy,
  paginatedResult,
  PaginatedResult,
  PaginationParams,
} from "../../../common/utils/pagination.util";

export interface PropertyFilters extends PaginationParams {
  type?: string;
  status?: string;
}

/**
 * Domain Repository for Real Estate & Property Lease Management.
 */
@Injectable()
export class RealEstateRepository {
  async findProperties(
    tenantId: string,
    params: PropertyFilters = {},
  ): Promise<PaginatedResult<any>> {
    const where: any = { tenantId };
    if (params.type) where.type = params.type;
    if (params.status) where.status = params.status;
    if (params.search) {
      where.OR = [
        { name: { contains: params.search, mode: "insensitive" } },
        { address: { contains: params.search, mode: "insensitive" } },
      ];
    }

    const { skip, take } = buildPaginationValues(params);
    const orderBy = buildOrderBy(params.sort);

    const [properties, total] = await Promise.all([
      prisma.realEstateProperty.findMany({
        where,
        skip,
        take,
        orderBy: orderBy as any,
      }),
      prisma.realEstateProperty.count({ where }),
    ]);

    return paginatedResult(properties, total, params);
  }

  async findPropertyById(tenantId: string, id: string): Promise<any | null> {
    return prisma.realEstateProperty.findFirst({
      where: { id, tenantId },
    });
  }
}
