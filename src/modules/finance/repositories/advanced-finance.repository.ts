import { Injectable } from "@nestjs/common";
import { prisma } from "@kannan19302/database";
import {
  buildPaginationValues,
  buildOrderBy,
  paginatedResult,
  PaginatedResult,
  PaginationParams,
} from "../../../common/utils/pagination.util";

export interface TaxRuleFilters extends PaginationParams {
  jurisdiction?: string;
  isActive?: boolean;
}

/**
 * Domain Repository for Advanced Finance, Multi-Currency, and Tax Engines.
 */
@Injectable()
export class AdvancedFinanceRepository {
  async findTaxRates(
    tenantId: string,
    params: TaxRuleFilters = {},
  ): Promise<PaginatedResult<any>> {
    const where: any = { tenantId };
    if (params.isActive !== undefined) where.isActive = params.isActive;
    if (params.search) {
      where.name = { contains: params.search, mode: "insensitive" };
    }

    const { skip, take } = buildPaginationValues(params);
    const orderBy = buildOrderBy(params.sort);

    const [taxRates, total] = await Promise.all([
      prisma.taxRate.findMany({
        where,
        skip,
        take,
        orderBy: orderBy as any,
      }),
      prisma.taxRate.count({ where }),
    ]);

    return paginatedResult(taxRates, total, params);
  }
}
