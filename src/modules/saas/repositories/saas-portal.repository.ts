import { Injectable } from "@nestjs/common";
import { prisma } from "@kannan19302/database";
import {
  buildPaginationValues,
  buildOrderBy,
  paginatedResult,
  PaginatedResult,
  PaginationParams,
} from "../../../common/utils/pagination.util";

export interface SaasTenantFilters extends PaginationParams {
  status?: string;
  planId?: string;
}

/**
 * Domain Repository for SaaS Portal Control Plane & Multi-Tenant Organization Directory.
 */
@Injectable()
export class SaasPortalRepository {
  async findTenants(params: SaasTenantFilters = {}): Promise<PaginatedResult<any>> {
    const where: any = {};
    if (params.status) where.status = params.status;
    if (params.search) {
      where.OR = [
        { name: { contains: params.search, mode: "insensitive" } },
        { slug: { contains: params.search, mode: "insensitive" } },
      ];
    }

    const { skip, take } = buildPaginationValues(params);
    const orderBy = buildOrderBy(params.sort);

    const [tenants, total] = await Promise.all([
      prisma.tenant.findMany({
        where,
        skip,
        take,
        orderBy: orderBy as any,
      }),
      prisma.tenant.count({ where }),
    ]);

    return paginatedResult(tenants, total, params);
  }

  async findTenantById(id: string): Promise<any | null> {
    return prisma.tenant.findUnique({
      where: { id },
    });
  }
}
