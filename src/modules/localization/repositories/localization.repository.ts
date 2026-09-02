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
 * Domain Repository for I18n Translations & Regional Locales.
 */
@Injectable()
export class LocalizationRepository {
  async findLocales(tenantId: string, params: PaginationParams = {}): Promise<PaginatedResult<any>> {
    const where: any = { tenantId, appSlug: "localization" };
    const { skip, take } = buildPaginationValues(params);
    const orderBy = buildOrderBy(params.sort);

    const [configs, total] = await Promise.all([
      prisma.appSettings.findMany({
        where,
        skip,
        take,
        orderBy: orderBy as any,
      }),
      prisma.appSettings.count({ where }),
    ]);

    return paginatedResult(configs, total, params);
  }
}
