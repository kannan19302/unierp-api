import { Injectable } from "@nestjs/common";
import { prisma } from "@kannan19302/database";
import {
  buildPaginationValues,
  buildOrderBy,
  paginatedResult,
  PaginatedResult,
  PaginationParams,
} from "../../../common/utils/pagination.util";

export interface DocumentFilters extends PaginationParams {
  type?: string;
}

/**
 * Domain Repository for Documents & ECM.
 */
@Injectable()
export class DocumentsRepository {
  async findDocuments(
    tenantId: string,
    params: DocumentFilters = {},
  ): Promise<PaginatedResult<any>> {
    const where: any = { tenantId };
    if (params.type) where.type = params.type;
    if (params.search) {
      where.name = { contains: params.search, mode: "insensitive" };
    }

    const { skip, take } = buildPaginationValues(params);
    const orderBy = buildOrderBy(params.sort);

    const [documents, total] = await Promise.all([
      prisma.webAsset.findMany({
        where,
        skip,
        take,
        orderBy: orderBy as any,
      }),
      prisma.webAsset.count({ where }),
    ]);

    return paginatedResult(documents, total, params);
  }
}
