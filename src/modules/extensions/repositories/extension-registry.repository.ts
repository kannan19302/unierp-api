import { Injectable } from "@nestjs/common";
import { prisma } from "@kannan19302/database";
import {
  buildPaginationValues,
  buildOrderBy,
  paginatedResult,
  PaginatedResult,
  PaginationParams,
} from "../../../common/utils/pagination.util";

/**
 * Domain Repository for Extension Registry & Package Catalog.
 */
@Injectable()
export class ExtensionRegistryRepository {
  async findCatalog(params: PaginationParams = {}): Promise<PaginatedResult<any>> {
    const { skip, take } = buildPaginationValues(params);
    const orderBy = buildOrderBy(params.sort);

    const [packages, total] = await Promise.all([
      prisma.tenantExtensionInstallation.findMany({
        skip,
        take,
        orderBy: orderBy as any,
      }),
      prisma.tenantExtensionInstallation.count(),
    ]);

    return paginatedResult(packages, total, params);
  }
}
