import { Injectable } from "@nestjs/common";
import { prisma } from "@kannan19302/database";
import {
  buildPaginationValues,
  buildOrderBy,
  paginatedResult,
  PaginatedResult,
  PaginationParams,
} from "../../../common/utils/pagination.util";

export interface OrgNodeFilters extends PaginationParams {
  parentId?: string;
  type?: string;
}

/**
 * Domain Repository for Organization Structure & Hierarchies.
 */
@Injectable()
export class OrgStructureRepository {
  async findDepartments(
    tenantId: string,
    params: OrgNodeFilters = {},
  ): Promise<PaginatedResult<any>> {
    const where: any = { tenantId };
    if (params.search) {
      where.OR = [
        { name: { contains: params.search, mode: "insensitive" } },
        { code: { contains: params.search, mode: "insensitive" } },
      ];
    }

    const { skip, take } = buildPaginationValues(params);
    const orderBy = buildOrderBy(params.sort);

    const [nodes, total] = await Promise.all([
      prisma.department.findMany({
        where,
        skip,
        take,
        orderBy: orderBy as any,
      }),
      prisma.department.count({ where }),
    ]);

    return paginatedResult(nodes, total, params);
  }
}
