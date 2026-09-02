import { Injectable } from "@nestjs/common";
import { prisma } from "@kannan19302/database";
import {
  buildPaginationValues,
  buildOrderBy,
  paginatedResult,
  PaginatedResult,
  PaginationParams,
} from "../../../common/utils/pagination.util";

export interface DevProjectFilters extends PaginationParams {
  kind?: string;
  status?: string;
}

/**
 * Domain Repository for Developer API Platform, Projects & Artifacts.
 */
@Injectable()
export class ApiPlatformRepository {
  async findProjects(
    tenantId: string,
    params: DevProjectFilters = {},
  ): Promise<PaginatedResult<any>> {
    const where: any = { tenantId };
    if (params.kind) where.kind = params.kind;
    if (params.status) where.status = params.status;
    if (params.search) {
      where.name = { contains: params.search, mode: "insensitive" };
    }

    const { skip, take } = buildPaginationValues(params);
    const orderBy = buildOrderBy(params.sort || "-updatedAt");

    const [projects, total] = await Promise.all([
      prisma.devProject.findMany({
        where,
        skip,
        take,
        orderBy: orderBy as any,
      }),
      prisma.devProject.count({ where }),
    ]);

    return paginatedResult(projects, total, params);
  }

  async findProjectById(tenantId: string, id: string): Promise<any | null> {
    return prisma.devProject.findFirst({
      where: { id, tenantId },
    });
  }
}
