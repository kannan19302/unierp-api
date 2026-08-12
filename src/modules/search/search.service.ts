import { Injectable, NotFoundException } from "@nestjs/common";
import { prisma } from "@kannan19302/database";
import { idpClient as idpPrisma } from "@/common/idp-client";

import { EventEmitter2 } from "@nestjs/event-emitter";

export interface SearchHit {
  entity: string;
  group: string;
  id: string;
  title: string;
  subtitle?: string;
  href: string;
  score?: number;
}

const MAX_PER_ENTITY = 10;

/**
 * E39 exit criterion (G-6): "Searching a term returns only records the
 * user may see — and result counts do not leak the existence of
 * others." Governs which permission gates each indexed entityType in
 * fulltextSearch()'s unified `SearchIndex` table — kept in one place,
 * matching the codes globalSearch() already enforces per entity, so
 * the two search paths cannot drift into checking different things
 * for the same entity type.
 */
const ENTITY_TYPE_PERMISSIONS: Record<string, string> = {
  customer: "crm.contact.read",
  lead: "crm.lead.read",
  product: "inventory.product.read",
  employee: "hr.employee.read",
};

@Injectable()
export class SearchService {
  constructor(private readonly eventEmitter: EventEmitter2) {}

  private async resolvePermissions(userId: string): Promise<string[]> {
    const userRoles = await idpPrisma.userRole.findMany({
      where: { userId },
      include: { role: true },
    });
    const permissions: string[] = [];
    for (const ur of userRoles) {
      try {
        const perms = JSON.parse(ur.role.permissions as string);
        if (Array.isArray(perms)) permissions.push(...perms);
      } catch {}
    }
    return permissions;
  }

  async globalSearch(
    tenantId: string,
    userId: string,
    query: string,
  ): Promise<SearchHit[]> {
    const q = query.trim();
    if (q.length < 2) return [];
    const permissions = await this.resolvePermissions(userId);
    const can = (code: string) => permissions.includes(code);
    const contains = { contains: q, mode: "insensitive" as const };
    const lookups: Array<Promise<SearchHit[]>> = [];

    if (can("crm.contact.read")) {
      lookups.push(
        prisma.customer
          .findMany({
            where: {
              tenantId,
              OR: [
                { name: contains },
                { email: contains },
                { phone: contains },
              ],
            },
            take: MAX_PER_ENTITY,
            select: { id: true, name: true, email: true },
          })
          .then((rows) =>
            rows.map((r) => ({
              entity: "customer",
              group: "Customers",
              id: r.id,
              title: r.name,
              subtitle: r.email ?? undefined,
              href: `/crm/customers?highlight=${r.id}`,
            })),
          ),
      );
    }

    if (can("crm.lead.read")) {
      lookups.push(
        prisma.lead
          .findMany({
            where: {
              tenantId,
              OR: [
                { firstName: contains },
                { lastName: contains },
                { company: contains },
                { email: contains },
              ],
            },
            take: MAX_PER_ENTITY,
            select: {
              id: true,
              firstName: true,
              lastName: true,
              company: true,
            },
          })
          .then((rows) =>
            rows.map((r) => ({
              entity: "lead",
              group: "Leads",
              id: r.id,
              title: `${r.firstName} ${r.lastName}`.trim(),
              subtitle: r.company ?? undefined,
              href: `/crm/leads?highlight=${r.id}`,
            })),
          ),
      );
    }

    if (can("inventory.product.read")) {
      lookups.push(
        prisma.product
          .findMany({
            where: {
              tenantId,
              OR: [
                { name: contains },
                { sku: contains },
                { barcode: contains },
              ],
            },
            take: MAX_PER_ENTITY,
            select: { id: true, name: true, sku: true },
          })
          .then((rows) =>
            rows.map((r) => ({
              entity: "product",
              group: "Products",
              id: r.id,
              title: r.name,
              subtitle: r.sku,
              href: `/inventory/products?highlight=${r.id}`,
            })),
          ),
      );
    }

    if (can("hr.employee.read")) {
      lookups.push(
        prisma.employee
          .findMany({
            where: {
              tenantId,
              OR: [
                { firstName: contains },
                { lastName: contains },
                { email: contains },
                { employeeCode: contains },
              ],
            },
            take: MAX_PER_ENTITY,
            select: {
              id: true,
              firstName: true,
              lastName: true,
              designation: true,
            },
          })
          .then((rows) =>
            rows.map((r) => ({
              entity: "employee",
              group: "Employees",
              id: r.id,
              title: `${r.firstName} ${r.lastName}`.trim(),
              subtitle: r.designation ?? undefined,
              href: `/hr/employees?highlight=${r.id}`,
            })),
          ),
      );
    }

    if (can("finance.invoice.read")) {
      lookups.push(
        prisma.invoice
          .findMany({
            where: { tenantId, invoiceNumber: contains },
            take: MAX_PER_ENTITY,
            select: { id: true, invoiceNumber: true, status: true },
          })
          .then((rows) =>
            rows.map((r) => ({
              entity: "invoice",
              group: "Invoices",
              id: r.id,
              title: r.invoiceNumber,
              subtitle: r.status,
              href: `/finance/invoices?highlight=${r.id}`,
            })),
          ),
      );
    }

    if (can("sales.order.read")) {
      lookups.push(
        prisma.salesOrder
          .findMany({
            where: { tenantId, orderNumber: contains },
            take: MAX_PER_ENTITY,
            select: { id: true, orderNumber: true, status: true },
          })
          .then((rows) =>
            rows.map((r) => ({
              entity: "sales-order",
              group: "Sales Orders",
              id: r.id,
              title: r.orderNumber,
              subtitle: r.status,
              href: `/sales/orders?highlight=${r.id}`,
            })),
          ),
      );
    }

    if (can("procurement.purchase-order.read")) {
      lookups.push(
        prisma.purchaseOrder
          .findMany({
            where: { tenantId, poNumber: contains },
            take: MAX_PER_ENTITY,
            select: { id: true, poNumber: true, status: true },
          })
          .then((rows) =>
            rows.map((r) => ({
              entity: "purchase-order",
              group: "Purchase Orders",
              id: r.id,
              title: r.poNumber,
              subtitle: r.status,
              href: `/procurement/purchase-orders?highlight=${r.id}`,
            })),
          ),
      );
    }

    if (can("projects.project.read")) {
      lookups.push(
        prisma.project
          .findMany({
            where: { tenantId, OR: [{ name: contains }, { code: contains }] },
            take: MAX_PER_ENTITY,
            select: { id: true, name: true, code: true },
          })
          .then((rows) =>
            rows.map((r) => ({
              entity: "project",
              group: "Projects",
              id: r.id,
              title: r.name,
              subtitle: r.code,
              href: `/projects?highlight=${r.id}`,
            })),
          ),
      );
    }

    const settled = await Promise.allSettled(lookups);
    const results = settled.flatMap((s) =>
      s.status === "fulfilled" ? s.value : [],
    );

    this.eventEmitter.emit("search.performed", {
      tenantId,
      userId,
      query: q,
      resultCount: results.length,
    });

    return results;
  }

  async indexContent(
    tenantId: string,
    entityType: string,
    entityId: string,
    data: {
      title: string;
      content: string;
      module: string;
      keywords?: string[];
      metadata?: Record<string, any>;
    },
  ) {
    return prisma.searchIndex.upsert({
      where: {
        tenantId_entityType_entityId: { tenantId, entityType, entityId },
      },
      update: {
        title: data.title,
        content: data.content,
        keywords: data.keywords ?? [],
        module: data.module,
        metadata: data.metadata ?? {},
        status: "ACTIVE",
      },
      create: {
        tenantId,
        entityType,
        entityId,
        title: data.title,
        content: data.content,
        keywords: data.keywords ?? [],
        module: data.module,
        metadata: data.metadata ?? {},
        status: "ACTIVE",
      },
    });
  }

  async removeIndex(tenantId: string, entityType: string, entityId: string) {
    const idx = await prisma.searchIndex.findUnique({
      where: {
        tenantId_entityType_entityId: { tenantId, entityType, entityId },
      },
    });
    if (!idx) throw new NotFoundException("Search index entry not found");
    return prisma.searchIndex.update({
      where: { id: idx.id },
      data: { status: "DELETED" },
    });
  }

  async fulltextSearch(
    tenantId: string,
    query: string,
    filters?: {
      module?: string;
      entityType?: string;
      limit?: number;
      offset?: number;
    },
    userId?: string,
  ) {
    const limit = filters?.limit ?? 20;
    const offset = filters?.offset ?? 0;

    // G-6: this is the SAME unified index globalSearch() reads from
    // per-entity with real permission checks — fulltextSearch() must
    // apply the same gate, not just tenant/status/module filters, or
    // it becomes a second, unguarded path to records a user cannot
    // read directly. If a specific entityType was requested and it's
    // gated, refuse outright rather than silently returning an empty
    // page — an empty page with total: 0 vs. a page of real hits both
    // leak nothing extra either way, but refusing is the honest
    // behavior for an explicitly-scoped-but-unauthorized request.
    const permissions = userId ? await this.resolvePermissions(userId) : [];
    const gatedEntityTypes = Object.keys(ENTITY_TYPE_PERMISSIONS);

    if (filters?.entityType && gatedEntityTypes.includes(filters.entityType)) {
      const required = ENTITY_TYPE_PERMISSIONS[filters.entityType];
      if (required && !permissions.includes(required)) {
        return { items: [], total: 0, limit, offset };
      }
    }

    const disallowedEntityTypes = gatedEntityTypes.filter((et) => {
      const required = ENTITY_TYPE_PERMISSIONS[et];
      return required && !permissions.includes(required);
    });

    const where: any = {
      tenantId,
      status: "ACTIVE",
      OR: [
        { title: { contains: query, mode: "insensitive" } },
        { content: { contains: query, mode: "insensitive" } },
      ],
    };
    if (filters?.module) where.module = filters.module;
    if (filters?.entityType) {
      where.entityType = filters.entityType;
    } else if (disallowedEntityTypes.length > 0) {
      where.entityType = { notIn: disallowedEntityTypes };
    }

    const [items, total] = await Promise.all([
      prisma.searchIndex.findMany({
        where,
        take: limit,
        skip: offset,
        orderBy: { updatedAt: "desc" },
      }),
      prisma.searchIndex.count({ where }),
    ]);

    return { items, total, limit, offset };
  }

  async getIndexRules(tenantId: string, module?: string) {
    const where: any = { tenantId };
    if (module) where.module = module;
    return prisma.searchIndexRule.findMany({
      where,
      orderBy: { weight: "desc" },
    });
  }

  async upsertIndexRule(
    tenantId: string,
    data: {
      entityType: string;
      module: string;
      fields: string[];
      weight?: number;
      isActive?: boolean;
    },
  ) {
    return prisma.searchIndexRule.upsert({
      where: { tenantId_entityType: { tenantId, entityType: data.entityType } },
      update: {
        module: data.module,
        fields: data.fields,
        weight: data.weight ?? 1,
        isActive: data.isActive ?? true,
      },
      create: {
        tenantId,
        entityType: data.entityType,
        module: data.module,
        fields: data.fields,
        weight: data.weight ?? 1,
        isActive: data.isActive ?? true,
      },
    });
  }

  async deleteIndexRule(tenantId: string, id: string) {
    const rule = await prisma.searchIndexRule.findFirst({
      where: { id, tenantId },
    });
    if (!rule) throw new NotFoundException("Index rule not found");
    return prisma.searchIndexRule.delete({ where: { id } });
  }

  async saveSearch(
    tenantId: string,
    userId: string,
    data: {
      name: string;
      query: string;
      filters?: Record<string, any>;
      scope?: string;
    },
  ) {
    return prisma.savedSearch.upsert({
      where: { tenantId_userId_name: { tenantId, userId, name: data.name } },
      update: {
        query: data.query,
        filters: data.filters ?? {},
        scope: data.scope ?? "ALL",
      },
      create: {
        tenantId,
        userId,
        name: data.name,
        query: data.query,
        filters: data.filters ?? {},
        scope: data.scope ?? "ALL",
      },
    });
  }

  async getSavedSearches(tenantId: string, userId: string) {
    return prisma.savedSearch.findMany({
      where: { tenantId, userId },
      orderBy: { createdAt: "desc" },
    });
  }

  async deleteSavedSearch(tenantId: string, userId: string, id: string) {
    const search = await prisma.savedSearch.findFirst({
      where: { id, tenantId, userId },
    });
    if (!search) throw new NotFoundException("Saved search not found");
    return prisma.savedSearch.delete({ where: { id } });
  }

  async logSearchQuery(
    tenantId: string,
    userId: string,
    data: {
      query: string;
      filters?: Record<string, any>;
      resultCount?: number;
      executionMs?: number;
      entityTypes?: string[];
    },
  ) {
    const log = await prisma.searchQueryLog.create({
      data: {
        tenantId,
        userId,
        query: data.query,
        filters: data.filters ?? {},
        resultCount: data.resultCount ?? 0,
        executionMs: data.executionMs ?? 0,
        entityTypes: data.entityTypes ?? [],
      },
    });
    return log;
  }

  async getRecentSearches(tenantId: string, userId: string, limit = 10) {
    return prisma.searchQueryLog.findMany({
      where: { tenantId, userId },
      orderBy: { createdAt: "desc" },
      take: limit,
      distinct: ["query"],
    });
  }

  async clearRecentSearches(tenantId: string, userId: string) {
    return prisma.searchQueryLog.deleteMany({ where: { tenantId, userId } });
  }

  async getSearchAnalytics(tenantId: string, startDate?: Date, endDate?: Date) {
    const where: any = { tenantId };
    if (startDate)
      where.createdAt = { ...(where.createdAt ?? {}), gte: startDate };
    if (endDate) where.createdAt = { ...(where.createdAt ?? {}), lte: endDate };

    const [
      totalQueries,
      uniqueUsers,
      avgResponseMs,
      topQueries,
      zeroResultQueries,
    ] = await Promise.all([
      prisma.searchQueryLog.count({ where }),
      prisma.searchQueryLog.groupBy({
        by: ["userId"],
        where,
        _count: { userId: true },
      }),
      prisma.searchQueryLog.aggregate({ where, _avg: { executionMs: true } }),
      prisma.searchQueryLog.groupBy({
        by: ["query"],
        where,
        _count: { query: true },
        orderBy: { _count: { query: "desc" } },
        take: 20,
      }),
      prisma.searchQueryLog.findMany({
        where: { ...where, resultCount: 0 },
        orderBy: { createdAt: "desc" },
        take: 20,
      }),
    ]);

    return {
      totalQueries,
      uniqueUsers: uniqueUsers.length,
      avgResponseMs: avgResponseMs._avg.executionMs ?? 0,
      topQueries: topQueries.map((q) => ({
        query: q.query,
        count: q._count.query,
      })),
      zeroResultQueries: zeroResultQueries.map((q) => ({
        query: q.query,
        createdAt: q.createdAt,
      })),
      dailyStats: [],
    };
  }

  async reindexEntity(tenantId: string, entityType: string, entityId: string) {
    const lookupMap: Record<
      string,
      {
        module: string;
        fetcher: () => Promise<{
          title: string;
          content: string;
          metadata: Record<string, any>;
        } | null>;
      }
    > = {};

    lookupMap["customer"] = {
      module: "crm",
      fetcher: async () => {
        const c = await prisma.customer.findFirst({
          where: { id: entityId, tenantId },
        });
        return c
          ? {
              title: c.name,
              content: `${c.name} ${c.email ?? ""} ${c.phone ?? ""}`,
              metadata: { email: c.email, phone: c.phone },
            }
          : null;
      },
    };

    lookupMap["product"] = {
      module: "inventory",
      fetcher: async () => {
        const p = await prisma.product.findFirst({
          where: { id: entityId, tenantId },
        });
        return p
          ? {
              title: p.name,
              content: `${p.name} ${p.sku ?? ""} ${p.description ?? ""}`,
              metadata: { sku: p.sku },
            }
          : null;
      },
    };

    if (!lookupMap[entityType])
      throw new NotFoundException(
        `No reindex handler for entity type: ${entityType}`,
      );
    const data = await lookupMap[entityType].fetcher();
    if (!data) throw new NotFoundException(`${entityType} not found`);
    return this.indexContent(tenantId, entityType, entityId, {
      ...data,
      module: lookupMap[entityType].module,
    });
  }
}
