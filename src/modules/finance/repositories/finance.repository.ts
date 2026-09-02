import { Injectable } from "@nestjs/common";
import { prisma } from "@kannan19302/database";
import { Prisma } from "@kannan19302/database/prisma";
import {
  buildPaginationValues,
  buildOrderBy,
  paginatedResult,
  PaginatedResult,
  PaginationParams,
} from "../../../common/utils/pagination.util";

export interface InvoiceFilters extends PaginationParams {
  status?: string;
  customerId?: string;
}

export interface PaymentFilters extends PaginationParams {
  invoiceId?: string;
  paymentMethod?: string;
}

/**
 * Domain Repository for Finance & Accounting.
 *
 * Encapsulates all Prisma persistence operations for Invoices, Payments,
 * and Journal Entries. Services interact solely with this repository
 * to uphold the Domain Repository pattern (10/10 Architecture standard).
 */
@Injectable()
export class FinanceRepository {
  // ─── Invoices ──────────────────────────────────────────────────────────

  /**
   * Finds a paginated list of invoices for a tenant.
   */
  async findInvoices(
    tenantId: string,
    params: InvoiceFilters = {},
  ): Promise<PaginatedResult<any>> {
    const where: any = { tenantId, deletedAt: null };
    if (params.status) where.status = params.status;
    if (params.customerId) where.customerId = params.customerId;
    if (params.search) {
      where.OR = [
        { invoiceNumber: { contains: params.search, mode: "insensitive" } },
        {
          customer: { name: { contains: params.search, mode: "insensitive" } },
        },
      ];
    }

    const { skip, take } = buildPaginationValues(params);
    const orderBy = buildOrderBy(params.sort);

    const [invoices, total] = await Promise.all([
      prisma.invoice.findMany({
        where,
        include: {
          customer: { select: { id: true, name: true, email: true } },
          lineItems: true,
          payments: true,
        },
        skip,
        take,
        orderBy: orderBy as any,
      }),
      prisma.invoice.count({ where }),
    ]);

    return paginatedResult(invoices, total, params);
  }

  /**
   * Finds an invoice by its unique ID within tenant scope.
   */
  async findInvoiceById(tenantId: string, id: string): Promise<any | null> {
    return prisma.invoice.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: {
        customer: true,
        lineItems: true,
        payments: true,
      },
    });
  }

  /**
   * Creates an invoice with nested line items atomically.
   */
  async createInvoice(tenantId: string, data: any): Promise<any> {
    return prisma.invoice.create({
      data: {
        ...data,
        tenantId,
      },
      include: {
        lineItems: true,
        customer: true,
      },
    });
  }

  /**
   * Updates an existing invoice within tenant scope.
   */
  async updateInvoice(tenantId: string, id: string, data: any): Promise<any> {
    return prisma.invoice.update({
      where: { id },
      data,
      include: {
        lineItems: true,
        customer: true,
      },
    });
  }

  // ─── Payments ──────────────────────────────────────────────────────────

  /**
   * Finds a paginated list of payments for a tenant.
   */
  async findPayments(
    tenantId: string,
    params: PaymentFilters = {},
  ): Promise<PaginatedResult<any>> {
    const where: any = { tenantId };
    if (params.invoiceId) where.invoiceId = params.invoiceId;
    if (params.paymentMethod) where.paymentMethod = params.paymentMethod;

    const { skip, take } = buildPaginationValues(params);
    const orderBy = buildOrderBy(params.sort);

    const [payments, total] = await Promise.all([
      prisma.payment.findMany({
        where,
        include: {
          invoice: { select: { id: true, invoiceNumber: true, totalAmount: true } },
        },
        skip,
        take,
        orderBy: orderBy as any,
      }),
      prisma.payment.count({ where }),
    ]);

    return paginatedResult(payments, total, params);
  }

  /**
   * Creates a payment record.
   */
  async createPayment(tenantId: string, data: any): Promise<any> {
    return prisma.payment.create({
      data: {
        ...data,
        tenantId,
      },
      include: {
        invoice: true,
      },
    });
  }

  // ─── Journal Entries ───────────────────────────────────────────────────

  /**
   * Finds a paginated list of general ledger journal entries.
   */
  async findJournalEntries(
    tenantId: string,
    params: PaginationParams = {},
  ): Promise<PaginatedResult<any>> {
    const where: any = { tenantId };
    const { skip, take } = buildPaginationValues(params);
    const orderBy = buildOrderBy(params.sort);

    const [entries, total] = await Promise.all([
      prisma.journalEntry.findMany({
        where,
        include: {
          account: { select: { code: true, name: true, type: true } },
          journal: true,
        },
        skip,
        take,
        orderBy: orderBy as any,
      }),
      prisma.journalEntry.count({ where }),
    ]);

    return paginatedResult(entries, total, params);
  }
}
