import { Injectable } from "@nestjs/common";
import { prisma } from "@kannan19302/database";
import {
  buildPaginationValues,
  buildOrderBy,
  paginatedResult,
  PaginatedResult,
  PaginationParams,
} from "../../../common/utils/pagination.util";

export interface ProductFilters extends PaginationParams {
  categoryId?: string;
  type?: string;
  isActive?: boolean;
}

export interface InventoryItemFilters extends PaginationParams {
  productId?: string;
  warehouseId?: string;
}

/**
 * Domain Repository for Inventory Management & Warehousing.
 */
@Injectable()
export class InventoryRepository {
  // ─── Products ──────────────────────────────────────────────────────────

  async findProducts(
    tenantId: string,
    params: ProductFilters = {},
  ): Promise<PaginatedResult<any>> {
    const where: any = { tenantId, deletedAt: null };
    if (params.categoryId) where.categoryId = params.categoryId;
    if (params.type) where.type = params.type;
    if (params.isActive !== undefined) where.isActive = params.isActive;
    if (params.search) {
      where.OR = [
        { name: { contains: params.search, mode: "insensitive" } },
        { sku: { contains: params.search, mode: "insensitive" } },
        { barcode: { contains: params.search, mode: "insensitive" } },
      ];
    }

    const { skip, take } = buildPaginationValues(params);
    const orderBy = buildOrderBy(params.sort);

    const [products, total] = await Promise.all([
      prisma.product.findMany({
        where,
        include: {
          productCategory: { select: { id: true, name: true } },
          inventoryItems: true,
        },
        skip,
        take,
        orderBy: orderBy as any,
      }),
      prisma.product.count({ where }),
    ]);

    return paginatedResult(products, total, params);
  }

  async findProductById(tenantId: string, id: string): Promise<any | null> {
    return prisma.product.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: {
        productCategory: true,
        inventoryItems: true,
      },
    });
  }

  async createProduct(tenantId: string, data: any): Promise<any> {
    return prisma.product.create({
      data: {
        ...data,
        tenantId,
      },
    });
  }

  // ─── Warehouses ────────────────────────────────────────────────────────

  async findWarehouses(
    tenantId: string,
    params: PaginationParams = {},
  ): Promise<PaginatedResult<any>> {
    const where: any = { tenantId };
    if (params.search) {
      where.OR = [
        { name: { contains: params.search, mode: "insensitive" } },
        { code: { contains: params.search, mode: "insensitive" } },
      ];
    }

    const { skip, take } = buildPaginationValues(params);
    const orderBy = buildOrderBy(params.sort);

    const [warehouses, total] = await Promise.all([
      prisma.warehouse.findMany({
        where,
        skip,
        take,
        orderBy: orderBy as any,
      }),
      prisma.warehouse.count({ where }),
    ]);

    return paginatedResult(warehouses, total, params);
  }

  // ─── Inventory Items & Stock Ledger ────────────────────────────────────

  async findInventoryItems(
    tenantId: string,
    params: InventoryItemFilters = {},
  ): Promise<PaginatedResult<any>> {
    const where: any = { tenantId };
    if (params.productId) where.productId = params.productId;
    if (params.warehouseId) where.warehouseId = params.warehouseId;

    const { skip, take } = buildPaginationValues(params);
    const orderBy = buildOrderBy(params.sort);

    const [items, total] = await Promise.all([
      prisma.inventoryItem.findMany({
        where,
        include: {
          product: { select: { id: true, name: true, sku: true } },
          warehouse: { select: { id: true, name: true, code: true } },
        },
        skip,
        take,
        orderBy: orderBy as any,
      }),
      prisma.inventoryItem.count({ where }),
    ]);

    return paginatedResult(items, total, params);
  }

  async createStockLedgerEntry(tenantId: string, data: any): Promise<any> {
    return prisma.stockLedgerEntry.create({
      data: {
        ...data,
        tenantId,
      },
    });
  }
}
