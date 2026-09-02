import { Injectable } from "@nestjs/common";
import { prisma } from "@kannan19302/database";
import {
  buildPaginationValues,
  buildOrderBy,
  paginatedResult,
  PaginatedResult,
  PaginationParams,
} from "../../../common/utils/pagination.util";

export interface ShipmentFilters extends PaginationParams {
  status?: string;
  type?: string;
}

/**
 * Domain Repository for Supply Chain & Logistics Operations.
 */
@Injectable()
export class SupplyChainRepository {
  // ─── Shipments ─────────────────────────────────────────────────────────

  async findShipments(
    tenantId: string,
    params: ShipmentFilters = {},
  ): Promise<PaginatedResult<any>> {
    const where: any = { tenantId };
    if (params.status) where.status = params.status;
    if (params.type) where.type = params.type;
    if (params.search) {
      where.OR = [
        { trackingNumber: { contains: params.search, mode: "insensitive" } },
        { shipmentNumber: { contains: params.search, mode: "insensitive" } },
      ];
    }

    const { skip, take } = buildPaginationValues(params);
    const orderBy = buildOrderBy(params.sort || "-createdAt");

    const [shipments, total] = await Promise.all([
      prisma.shipment.findMany({
        where,
        skip,
        take,
        orderBy: orderBy as any,
      }),
      prisma.shipment.count({ where }),
    ]);

    return paginatedResult(shipments, total, params);
  }

  async findShipmentById(tenantId: string, id: string): Promise<any | null> {
    return prisma.shipment.findFirst({
      where: { id, tenantId },
    });
  }

  async createShipment(tenantId: string, data: any): Promise<any> {
    return prisma.shipment.create({
      data: {
        ...data,
        tenantId,
      },
    });
  }
}
