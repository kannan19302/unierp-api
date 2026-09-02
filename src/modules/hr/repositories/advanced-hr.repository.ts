import { Injectable } from "@nestjs/common";
import { prisma } from "@kannan19302/database";
import {
  buildPaginationValues,
  buildOrderBy,
  paginatedResult,
  PaginatedResult,
  PaginationParams,
} from "../../../common/utils/pagination.util";

export interface PayrollRunFilters extends PaginationParams {
  status?: string;
  period?: string;
}

/**
 * Domain Repository for Advanced HR, Payroll Runs, and Global Compensation.
 */
@Injectable()
export class AdvancedHrRepository {
  async findPayrollRuns(
    tenantId: string,
    params: PayrollRunFilters = {},
  ): Promise<PaginatedResult<any>> {
    const where: any = { tenantId };
    if (params.status) where.status = params.status;
    if (params.period) where.period = params.period;

    const { skip, take } = buildPaginationValues(params);
    const orderBy = buildOrderBy(params.sort);

    const [runs, total] = await Promise.all([
      prisma.payrollRun.findMany({
        where,
        skip,
        take,
        orderBy: orderBy as any,
      }),
      prisma.payrollRun.count({ where }),
    ]);

    return paginatedResult(runs, total, params);
  }

  async findPayrollRunById(tenantId: string, id: string): Promise<any | null> {
    return prisma.payrollRun.findFirst({
      where: { id, tenantId },
    });
  }
}
