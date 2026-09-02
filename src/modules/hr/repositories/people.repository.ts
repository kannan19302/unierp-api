import { Injectable } from "@nestjs/common";
import { prisma } from "@kannan19302/database";
import {
  buildPaginationValues,
  buildOrderBy,
  paginatedResult,
  PaginatedResult,
  PaginationParams,
} from "../../../common/utils/pagination.util";

export interface PeopleFilters extends PaginationParams {
  departmentId?: string;
  status?: string;
}

/**
 * Domain Repository for People Directory & Employee Profiles.
 */
@Injectable()
export class PeopleRepository {
  async findPeople(
    tenantId: string,
    params: PeopleFilters = {},
  ): Promise<PaginatedResult<any>> {
    const where: any = { tenantId };
    if (params.departmentId) where.departmentId = params.departmentId;
    if (params.status) where.status = params.status;
    if (params.search) {
      where.OR = [
        { firstName: { contains: params.search, mode: "insensitive" } },
        { lastName: { contains: params.search, mode: "insensitive" } },
        { email: { contains: params.search, mode: "insensitive" } },
      ];
    }

    const { skip, take } = buildPaginationValues(params);
    const orderBy = buildOrderBy(params.sort);

    const [people, total] = await Promise.all([
      prisma.employee.findMany({
        where,
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          designation: true,
          department: { select: { id: true, name: true } },
        },
        skip,
        take,
        orderBy: orderBy as any,
      }),
      prisma.employee.count({ where }),
    ]);

    return paginatedResult(people, total, params);
  }
}
