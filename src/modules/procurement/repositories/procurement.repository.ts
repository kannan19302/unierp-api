import { Injectable } from "@nestjs/common";
import { prisma } from "@kannan19302/database";
import {
  buildPaginationValues,
  buildOrderBy,
  paginatedResult,
  PaginatedResult,
  PaginationParams,
} from "../../../common/utils/pagination.util";

export interface VendorFilters extends PaginationParams {
  status?: string;
  category?: string;
}

export interface PurchaseOrderFilters extends PaginationParams {
  status?: string;
  vendorId?: string;
}

/**
 * Domain Repository for Procurement & Vendor Management.
 */
@Injectable()
export class ProcurementRepository {
  // ─── Vendors ───────────────────────────────────────────────────────────

  async findVendors(
    tenantId: string,
    params: VendorFilters = {},
  ): Promise<PaginatedResult<any>> {
    const where: any = { tenantId };
    if (params.status) where.status = params.status;
    if (params.category) where.category = params.category;
    if (params.search) {
      where.OR = [
        { name: { contains: params.search, mode: "insensitive" } },
        { code: { contains: params.search, mode: "insensitive" } },
        { email: { contains: params.search, mode: "insensitive" } },
      ];
    }

    const { skip, take } = buildPaginationValues(params);
    const orderBy = buildOrderBy(params.sort);

    const [vendors, total] = await Promise.all([
      prisma.vendor.findMany({
        where,
        skip,
        take,
        orderBy: orderBy as any,
      }),
      prisma.vendor.count({ where }),
    ]);

    return paginatedResult(vendors, total, params);
  }

  async findVendorById(tenantId: string, id: string): Promise<any | null> {
    return prisma.vendor.findFirst({
      where: { id, tenantId },
      include: {
        purchaseOrders: { take: 10, orderBy: { createdAt: "desc" } },
      },
    });
  }

  async createVendor(tenantId: string, data: any): Promise<any> {
    return prisma.vendor.create({
      data: {
        ...data,
        tenantId,
      },
    });
  }

  // ─── Purchase Orders ───────────────────────────────────────────────────

  async findPurchaseOrders(
    tenantId: string,
    params: PurchaseOrderFilters = {},
  ): Promise<PaginatedResult<any>> {
    const where: any = { tenantId };
    if (params.status) where.status = params.status;
    if (params.vendorId) where.vendorId = params.vendorId;
    if (params.search) {
      where.OR = [
        { orderNumber: { contains: params.search, mode: "insensitive" } },
        { vendor: { name: { contains: params.search, mode: "insensitive" } } },
      ];
    }

    const { skip, take } = buildPaginationValues(params);
    const orderBy = buildOrderBy(params.sort);

    const [orders, total] = await Promise.all([
      prisma.purchaseOrder.findMany({
        where,
        include: {
          vendor: { select: { id: true, name: true, email: true } },
          lineItems: true,
        },
        skip,
        take,
        orderBy: orderBy as any,
      }),
      prisma.purchaseOrder.count({ where }),
    ]);

    return paginatedResult(orders, total, params);
  }

  async createPurchaseOrder(tenantId: string, data: any): Promise<any> {
    return prisma.purchaseOrder.create({
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
