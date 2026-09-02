import { Injectable } from "@nestjs/common";
import { prisma } from "@kannan19302/database";
import {
  buildPaginationValues,
  buildOrderBy,
  paginatedResult,
  PaginatedResult,
  PaginationParams,
} from "../../../common/utils/pagination.util";

export interface BomFilters extends PaginationParams {
  productId?: string;
}

export interface WorkOrderFilters extends PaginationParams {
  status?: string;
  bomId?: string;
}

/**
 * Domain Repository for Manufacturing & MRP Operations.
 */
@Injectable()
export class ManufacturingRepository {
  // ─── Bills of Materials (BOM) ──────────────────────────────────────────

  async findBoms(
    tenantId: string,
    params: BomFilters = {},
  ): Promise<PaginatedResult<any>> {
    const where: any = { tenantId };
    if (params.productId) where.productId = params.productId;
    if (params.search) {
      where.bomNumber = { contains: params.search, mode: "insensitive" };
    }

    const { skip, take } = buildPaginationValues(params);
    const orderBy = buildOrderBy(params.sort);

    const [boms, total] = await Promise.all([
      prisma.bOM.findMany({
        where,
        skip,
        take,
        orderBy: orderBy as any,
      }),
      prisma.bOM.count({ where }),
    ]);

    return paginatedResult(boms, total, params);
  }

  async findBomById(tenantId: string, id: string): Promise<any | null> {
    return prisma.bOM.findFirst({
      where: { id, tenantId },
    });
  }

  async createBom(tenantId: string, data: any): Promise<any> {
    return prisma.bOM.create({
      data: {
        ...data,
        tenantId,
      },
    });
  }

  // ─── Work Orders ───────────────────────────────────────────────────────

  async findWorkOrders(
    tenantId: string,
    params: WorkOrderFilters = {},
  ): Promise<PaginatedResult<any>> {
    const where: any = { tenantId };
    if (params.status) where.status = params.status;
    if (params.bomId) where.bomId = params.bomId;
    if (params.search) {
      where.workOrderNumber = { contains: params.search, mode: "insensitive" };
    }

    const { skip, take } = buildPaginationValues(params);
    const orderBy = buildOrderBy(params.sort);

    const [orders, total] = await Promise.all([
      prisma.workOrder.findMany({
        where,
        include: {
          operations: true,
        },
        skip,
        take,
        orderBy: orderBy as any,
      }),
      prisma.workOrder.count({ where }),
    ]);

    return paginatedResult(orders, total, params);
  }

  async createWorkOrder(tenantId: string, data: any): Promise<any> {
    return prisma.workOrder.create({
      data: {
        ...data,
        tenantId,
      },
    });
  }
}
