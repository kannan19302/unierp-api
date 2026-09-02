import { Injectable } from "@nestjs/common";
import { prisma } from "@kannan19302/database";
import {
  buildPaginationValues,
  buildOrderBy,
  paginatedResult,
  PaginatedResult,
  PaginationParams,
} from "../../../common/utils/pagination.util";

export interface PosShiftFilters extends PaginationParams {
  status?: string;
  registerId?: string;
}

export interface PosTransactionFilters extends PaginationParams {
  shiftId?: string;
  status?: string;
}

/**
 * Domain Repository for Point of Sale (POS) & Retail Checkout.
 */
@Injectable()
export class PosRepository {
  // ─── POS Registers & Shifts ────────────────────────────────────────────

  async findShifts(
    tenantId: string,
    params: PosShiftFilters = {},
  ): Promise<PaginatedResult<any>> {
    const where: any = { tenantId };
    if (params.status) where.status = params.status;
    if (params.registerId) where.registerId = params.registerId;

    const { skip, take } = buildPaginationValues(params);
    const orderBy = buildOrderBy(params.sort);

    const [shifts, total] = await Promise.all([
      prisma.pOSShift.findMany({
        where,
        skip,
        take,
        orderBy: orderBy as any,
      }),
      prisma.pOSShift.count({ where }),
    ]);

    return paginatedResult(shifts, total, params);
  }

  async createShift(tenantId: string, data: any): Promise<any> {
    return prisma.pOSShift.create({
      data: {
        ...data,
        tenantId,
      },
    });
  }

  // ─── POS Transactions ──────────────────────────────────────────────────

  async findTransactions(
    tenantId: string,
    params: PosTransactionFilters = {},
  ): Promise<PaginatedResult<any>> {
    const where: any = { tenantId };
    if (params.shiftId) where.shiftId = params.shiftId;

    const { skip, take } = buildPaginationValues(params);
    const orderBy = buildOrderBy(params.sort);

    const [transactions, total] = await Promise.all([
      prisma.posShiftTransaction.findMany({
        where,
        skip,
        take,
        orderBy: orderBy as any,
      }),
      prisma.posShiftTransaction.count({ where }),
    ]);

    return paginatedResult(transactions, total, params);
  }

  async createTransaction(tenantId: string, data: any): Promise<any> {
    return prisma.posShiftTransaction.create({
      data: {
        ...data,
        tenantId,
      },
    });
  }
}
