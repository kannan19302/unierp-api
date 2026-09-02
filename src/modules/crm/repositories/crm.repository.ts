import { Injectable } from "@nestjs/common";
import { prisma } from "@kannan19302/database";
import {
  buildPaginationValues,
  buildOrderBy,
  paginatedResult,
  PaginatedResult,
  PaginationParams,
} from "../../../common/utils/pagination.util";

export interface CustomerFilters extends PaginationParams {
  status?: string;
  type?: string;
}

export interface LeadFilters extends PaginationParams {
  status?: string;
  source?: string;
}

export interface DealFilters extends PaginationParams {
  stage?: string;
  customerId?: string;
}

/**
 * Domain Repository for CRM, Customers, Leads, and Opportunities.
 */
@Injectable()
export class CrmRepository {
  // ─── Customers ─────────────────────────────────────────────────────────

  async findCustomers(
    tenantId: string,
    params: CustomerFilters = {},
  ): Promise<PaginatedResult<any>> {
    const where: any = { tenantId };
    if (params.status) where.status = params.status;
    if (params.type) where.type = params.type;
    if (params.search) {
      where.OR = [
        { name: { contains: params.search, mode: "insensitive" } },
        { email: { contains: params.search, mode: "insensitive" } },
        { phone: { contains: params.search, mode: "insensitive" } },
      ];
    }

    const { skip, take } = buildPaginationValues(params);
    const orderBy = buildOrderBy(params.sort);

    const [customers, total] = await Promise.all([
      prisma.customer.findMany({
        where,
        include: {
          contacts: true,
        },
        skip,
        take,
        orderBy: orderBy as any,
      }),
      prisma.customer.count({ where }),
    ]);

    return paginatedResult(customers, total, params);
  }

  async findCustomerById(tenantId: string, id: string): Promise<any | null> {
    return prisma.customer.findFirst({
      where: { id, tenantId },
      include: {
        contacts: true,
      },
    });
  }

  async createCustomer(tenantId: string, data: any): Promise<any> {
    return prisma.customer.create({
      data: {
        ...data,
        tenantId,
      },
    });
  }

  // ─── Leads ─────────────────────────────────────────────────────────────

  async findLeads(
    tenantId: string,
    params: LeadFilters = {},
  ): Promise<PaginatedResult<any>> {
    const where: any = { tenantId };
    if (params.status) where.status = params.status;
    if (params.source) where.source = params.source;
    if (params.search) {
      where.OR = [
        { firstName: { contains: params.search, mode: "insensitive" } },
        { lastName: { contains: params.search, mode: "insensitive" } },
        { email: { contains: params.search, mode: "insensitive" } },
        { company: { contains: params.search, mode: "insensitive" } },
      ];
    }

    const { skip, take } = buildPaginationValues(params);
    const orderBy = buildOrderBy(params.sort);

    const [leads, total] = await Promise.all([
      prisma.lead.findMany({
        where,
        skip,
        take,
        orderBy: orderBy as any,
      }),
      prisma.lead.count({ where }),
    ]);

    return paginatedResult(leads, total, params);
  }

  async createLead(tenantId: string, data: any): Promise<any> {
    return prisma.lead.create({
      data: {
        ...data,
        tenantId,
      },
    });
  }

  // ─── Opportunities / Deals ─────────────────────────────────────────────

  async findOpportunities(
    tenantId: string,
    params: DealFilters = {},
  ): Promise<PaginatedResult<any>> {
    const where: any = { tenantId };
    if (params.stage) where.stage = params.stage;
    if (params.customerId) where.customerId = params.customerId;
    if (params.search) {
      where.name = { contains: params.search, mode: "insensitive" };
    }

    const { skip, take } = buildPaginationValues(params);
    const orderBy = buildOrderBy(params.sort);

    const [opportunities, total] = await Promise.all([
      prisma.opportunity.findMany({
        where,
        include: {
          customer: { select: { id: true, name: true } },
        },
        skip,
        take,
        orderBy: orderBy as any,
      }),
      prisma.opportunity.count({ where }),
    ]);

    return paginatedResult(opportunities, total, params);
  }
}
