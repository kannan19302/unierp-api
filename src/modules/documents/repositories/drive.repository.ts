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
 * Domain Repository for Drive Cloud Storage & File Folders.
 */
@Injectable()
export class DriveRepository {
  async findFiles(
    tenantId: string,
    params: PaginationParams = {},
  ): Promise<PaginatedResult<any>> {
    const where: any = { tenantId };
    if (params.search) {
      where.name = { contains: params.search, mode: "insensitive" };
    }

    const { skip, take } = buildPaginationValues(params);
    const orderBy = buildOrderBy(params.sort);

    const [files, total] = await Promise.all([
      prisma.webAsset.findMany({
        where,
        skip,
        take,
        orderBy: orderBy as any,
      }),
      prisma.webAsset.count({ where }),
    ]);

    return paginatedResult(files, total, params);
  }
}
