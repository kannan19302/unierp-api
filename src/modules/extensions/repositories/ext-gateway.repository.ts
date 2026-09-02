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
 * Domain Repository for Extension Gateway & External Integration Endpoints.
 */
@Injectable()
export class ExtGatewayRepository {
  async findIntegrations(
    tenantId: string,
    params: PaginationParams = {},
  ): Promise<PaginatedResult<any>> {
    const where: any = { tenantId };
    const { skip, take } = buildPaginationValues(params);
    const orderBy = buildOrderBy(params.sort);

    const [integrations, total] = await Promise.all([
      prisma.tenantExtensionInstallation.findMany({
        where,
        skip,
        take,
        orderBy: orderBy as any,
      }),
      prisma.tenantExtensionInstallation.count({ where }),
    ]);

    return paginatedResult(integrations, total, params);
  }
}
