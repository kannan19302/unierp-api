import { Injectable } from "@nestjs/common";
import { prisma } from "@kannan19302/database";
import {
  buildPaginationValues,
  buildOrderBy,
  paginatedResult,
  PaginatedResult,
  PaginationParams,
} from "../../../common/utils/pagination.util";

/**
 * Domain Repository for Global Enterprise Search & Indexing.
 */
@Injectable()
export class SearchRepository {
  async searchGlobal(tenantId: string, query: string): Promise<any> {
    const [customers, products, invoices, employees] = await Promise.all([
      prisma.customer.findMany({
        where: { tenantId, name: { contains: query, mode: "insensitive" } },
        take: 5,
        select: { id: true, name: true, email: true },
      }),
      prisma.product.findMany({
        where: { tenantId, name: { contains: query, mode: "insensitive" } },
        take: 5,
        select: { id: true, name: true, sku: true },
      }),
      prisma.invoice.findMany({
        where: { tenantId, invoiceNumber: { contains: query, mode: "insensitive" } },
        take: 5,
        select: { id: true, invoiceNumber: true, totalAmount: true },
      }),
      prisma.employee.findMany({
        where: {
          tenantId,
          OR: [
            { firstName: { contains: query, mode: "insensitive" } },
            { lastName: { contains: query, mode: "insensitive" } },
          ],
        },
        take: 5,
        select: { id: true, firstName: true, lastName: true, email: true },
      }),
    ]);

    return { customers, products, invoices, employees };
  }
}
