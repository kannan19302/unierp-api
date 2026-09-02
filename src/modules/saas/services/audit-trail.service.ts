/**
 * D05 — a real, searchable/filterable/exportable tenant audit trail
 * against the real ChangeHistory table (the same tenant-scoped,
 * field-level change log the platform's own retention matrix already
 * declares). "Who changed this and when" for any record is answered by
 * filtering to entityType/entityId; "exports evidence for an auditor"
 * is exportAuditLogs(), a flat structure over the same real rows the
 * search returns — never a second, synthetic dataset.
 */
import { Injectable } from "@nestjs/common";
import { prisma } from "@kannan19302/database";

export interface AuditTrailFilter {
  entityType?: string;
  entityId?: string;
  userId?: string;
  action?: string;
  from?: Date;
  to?: Date;
}

const DEFAULT_PAGE_SIZE = 50;

@Injectable()
export class SaasPortalAuditTrailDeepService {
  private buildWhere(tenantId: string, filter: AuditTrailFilter) {
    const where: Record<string, unknown> = { tenantId };
    if (filter.entityType) where.entityType = filter.entityType;
    if (filter.entityId) where.entityId = filter.entityId;
    if (filter.userId) where.userId = filter.userId;
    if (filter.action) where.action = filter.action;
    if (filter.from || filter.to) {
      where.createdAt = {
        ...(filter.from ? { gte: filter.from } : {}),
        ...(filter.to ? { lte: filter.to } : {}),
      };
    }
    return where;
  }

  /** Searchable/filterable, most-recent-first, paginated. Answers "who
   *  changed this and when" for any record by entityType+entityId. */
  async getAuditLogs(tenantId: string, filter: AuditTrailFilter = {}, page: number = 1, pageSize: number = DEFAULT_PAGE_SIZE) {
    const where = this.buildWhere(tenantId, filter);
    const [entries, total] = await Promise.all([
      (prisma as any).changeHistory.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      (prisma as any).changeHistory.count({ where }),
    ]);
    return { entries, total, page, pageSize };
  }

  /** Every REAL matching record, unpaginated — the evidence set an
   *  auditor gets, over the identical table the search reads. */
  async exportAuditLogs(tenantId: string, filter: AuditTrailFilter = {}) {
    const where = this.buildWhere(tenantId, filter);
    return (prisma as any).changeHistory.findMany({ where, orderBy: { createdAt: "desc" } });
  }
}
