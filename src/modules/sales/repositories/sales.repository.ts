import { Injectable } from "@nestjs/common";
import { prisma } from "@kannan19302/database";
import {
  buildPaginationValues,
  buildOrderBy,
  paginatedResult,
  PaginatedResult,
  PaginationParams,
} from "../../../common/utils/pagination.util";

export interface SalesOrderFilters extends PaginationParams {
  status?: string;
  customerId?: string;
}

export interface QuotationFilters extends PaginationParams {
  status?: string;
  customerId?: string;
}

/**
 * Domain Repository for Sales Orders, Quotations, and Revenue Operations.
 */
@Injectable()
export class SalesRepository {
  // ─── Sales Orders ──────────────────────────────────────────────────────

  async findOrders(
    tenantId: string,
    params: SalesOrderFilters = {},
  ): Promise<PaginatedResult<any>> {
    const where: any = { tenantId };
    if (params.status) where.status = params.status;
    if (params.customerId) where.customerId = params.customerId;
    if (params.search) {
      where.OR = [
        { orderNumber: { contains: params.search, mode: "insensitive" } },
        { customer: { name: { contains: params.search, mode: "insensitive" } } },
      ];
    }

    const { skip, take } = buildPaginationValues(params);
    const orderBy = buildOrderBy(params.sort);

    const [orders, total] = await Promise.all([
      prisma.salesOrder.findMany({
        where,
        include: {
          customer: { select: { id: true, name: true, email: true } },
          lineItems: true,
        },
        skip,
        take,
        orderBy: orderBy as any,
      }),
      prisma.salesOrder.count({ where }),
    ]);

    return paginatedResult(orders, total, params);
  }

  async findOrderById(tenantId: string, id: string): Promise<any | null> {
    return prisma.salesOrder.findFirst({
      where: { id, tenantId },
      include: {
        customer: true,
        lineItems: true,
      },
    });
  }

  async createOrder(tenantId: string, data: any): Promise<any> {
    return prisma.salesOrder.create({
      data: {
        ...data,
        tenantId,
      },
      include: {
        lineItems: true,
      },
    });
  }

  async updateOrderStatus(
    tenantId: string,
    id: string,
    status: any,
  ): Promise<any> {
    return prisma.salesOrder.update({
      where: { id },
      data: { status },
    });
  }

  // ─── Quotations ────────────────────────────────────────────────────────

  async findQuotations(
    tenantId: string,
    params: QuotationFilters = {},
  ): Promise<PaginatedResult<any>> {
    const where: any = { tenantId };
    if (params.status) where.status = params.status;
    if (params.customerId) where.customerId = params.customerId;
    if (params.search) {
      where.OR = [
        { quotationNumber: { contains: params.search, mode: "insensitive" } },
        { customer: { name: { contains: params.search, mode: "insensitive" } } },
      ];
    }

    const { skip, take } = buildPaginationValues(params);
    const orderBy = buildOrderBy(params.sort);

    const [quotations, total] = await Promise.all([
      prisma.quotation.findMany({
        where,
        include: {
          customer: { select: { id: true, name: true } },
          lineItems: true,
        },
        skip,
        take,
        orderBy: orderBy as any,
      }),
      prisma.quotation.count({ where }),
    ]);

    return paginatedResult(quotations, total, params);
  }

  async createQuotation(tenantId: string, data: any): Promise<any> {
    return prisma.quotation.create({
      data: {
        ...data,
        tenantId,
      },
      include: {
        lineItems: true,
      },
    });
  }
}
