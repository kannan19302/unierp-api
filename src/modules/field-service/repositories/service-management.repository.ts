import { Injectable } from "@nestjs/common";
import { prisma } from "@kannan19302/database";
import {
  buildPaginationValues,
  buildOrderBy,
  paginatedResult,
  PaginatedResult,
  PaginationParams,
} from "../../../common/utils/pagination.util";

export interface ServiceContractFilters extends PaginationParams {
  status?: string;
}

/**
 * Domain Repository for Service Management & SLA Contracts.
 */
@Injectable()
export class ServiceManagementRepository {
  async findContracts(
    tenantId: string,
    params: ServiceContractFilters = {},
  ): Promise<PaginatedResult<any>> {
    const where: any = { tenantId };
    if (params.status) where.status = params.status;
    if (params.search) {
      where.OR = [
        { contractNumber: { contains: params.search, mode: "insensitive" } },
        { title: { contains: params.search, mode: "insensitive" } },
      ];
    }

    const { skip, take } = buildPaginationValues(params);
    const orderBy = buildOrderBy(params.sort);

    const [contracts, total] = await Promise.all([
      prisma.fieldServiceContract.findMany({
        where,
        skip,
        take,
        orderBy: orderBy as any,
      }),
      prisma.fieldServiceContract.count({ where }),
    ]);

    return paginatedResult(contracts, total, params);
  }

  async findContractById(tenantId: string, id: string): Promise<any | null> {
    return prisma.fieldServiceContract.findFirst({
      where: { id, tenantId },
    });
  }

  async createContract(tenantId: string, data: any): Promise<any> {
    return prisma.fieldServiceContract.create({
      data: {
        ...data,
        tenantId,
      },
    });
  }
}
