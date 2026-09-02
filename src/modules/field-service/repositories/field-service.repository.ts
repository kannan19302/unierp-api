import { Injectable } from "@nestjs/common";
import { prisma } from "@kannan19302/database";
import {
  buildPaginationValues,
  buildOrderBy,
  paginatedResult,
  PaginatedResult,
  PaginationParams,
} from "../../../common/utils/pagination.util";

export interface FieldServiceWorkOrderFilters extends PaginationParams {
  status?: string;
}

/**
 * Domain Repository for Field Service Management & Technician Dispatch.
 */
@Injectable()
export class FieldServiceRepository {
  async findWorkOrders(
    tenantId: string,
    params: FieldServiceWorkOrderFilters = {},
  ): Promise<PaginatedResult<any>> {
    const where: any = { tenantId };
    if (params.status) where.status = params.status;
    if (params.search) {
      where.workOrderNumber = { contains: params.search, mode: "insensitive" };
    }

    const { skip, take } = buildPaginationValues(params);
    const orderBy = buildOrderBy(params.sort);

    const [workOrders, total] = await Promise.all([
      prisma.workOrder.findMany({
        where,
        skip,
        take,
        orderBy: orderBy as any,
      }),
      prisma.workOrder.count({ where }),
    ]);

    return paginatedResult(workOrders, total, params);
  }

  async findWorkOrderById(tenantId: string, id: string): Promise<any | null> {
    return prisma.workOrder.findFirst({
      where: { id, tenantId },
    });
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
