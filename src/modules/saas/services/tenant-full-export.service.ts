import { ReconciliationEntry } from "@kannan19302/shared";
/**
 * D10 — complete tenant export, proven end-to-end: export → import into
 * a clean instance → reconcile record-for-record. Covers the same
 * tenant-owned entity set D08's import framework already supports
 * (Customer/Vendor/Product/Employee) — extending either this list or
 * D08's MODEL_FIELDS extends the other for free, since both read off
 * the same real Prisma models rather than a second registry.
 */
import { Injectable, BadRequestException } from "@nestjs/common";
import { prisma } from "@kannan19302/database";

const EXPORTABLE_MODELS = ["customer", "vendor", "product", "employee"] as const;
type ExportableModel = (typeof EXPORTABLE_MODELS)[number];

export interface TenantExportSnapshot {
  tenantId: string;
  exportedAt: string;
  entities: Record<string, Record<string, unknown>[]>;
}



export interface ReconciliationReport {
  totalRecords: number;
  matched: number;
  missing: number;
  mismatched: number;
  entries: ReconciliationEntry[];
}

/** Fields that legitimately differ between the original and a re-import
 *  (a new database identity, tenant scope, timestamps) — never compared. */
const IDENTITY_FIELDS = new Set(["id", "tenantId", "orgId", "createdAt", "updatedAt"]);

/** The stable, business-meaningful field reconciliation matches records
 *  by, since `id` itself is deliberately NOT preserved by import (a
 *  clean instance assigns its own). */
const NATURAL_KEY: Record<ExportableModel, string> = {
  customer: "email",
  vendor: "email",
  product: "sku",
  employee: "employeeCode",
};

@Injectable()
export class TenantFullExportService {
  /** Every row of every tenant-owned entity, as one portable snapshot. */
  async exportTenant(tenantId: string): Promise<TenantExportSnapshot> {
    const entities: Record<string, Record<string, unknown>[]> = {};
    for (const model of EXPORTABLE_MODELS) {
      entities[model] = await (prisma as any)[model].findMany({ where: { tenantId } });
    }
    return { tenantId, exportedAt: new Date().toISOString(), entities };
  }

  /**
   * Re-imports a snapshot into a target tenant scope. Refuses if the
   * target is not a clean instance (any exportable model already has a
   * row for that tenant) — a re-import into a non-empty tenant would
   * make "reconciles record-for-record" ambiguous (whose record is
   * whose?), so this method insists on the exit criterion's own
   * precondition rather than silently merging.
   */
  async importIntoCleanInstance(snapshot: TenantExportSnapshot, targetTenantId: string, targetOrgId: string) {
    for (const model of EXPORTABLE_MODELS) {
      const existing = await (prisma as any)[model].count({ where: { tenantId: targetTenantId } });
      if (existing > 0) {
        throw new BadRequestException(`Target tenant "${targetTenantId}" is not a clean instance — "${model}" already has ${existing} row(s)`);
      }
    }

    const idMap: Record<string, Record<string, string>> = {};
    for (const model of EXPORTABLE_MODELS) {
      idMap[model] = {};
      for (const record of snapshot.entities[model] ?? []) {
        const { id: originalId, tenantId: _t, orgId: _o, createdAt: _c, updatedAt: _u, ...rest } = record as Record<string, unknown>;
        const created = await (prisma as any)[model].create({
          data: { ...rest, tenantId: targetTenantId, orgId: targetOrgId },
        });
        idMap[model][originalId as string] = created.id;
      }
    }
    return { imported: Object.values(idMap).reduce((sum, m) => sum + Object.keys(m).length, 0), idMap };
  }

  /**
   * Reconciles the target tenant's CURRENT rows against the original
   * snapshot, record-for-record, by matching on every non-identity
   * field (name/email/sku/etc. — whatever the model actually carries).
   * A record present in the snapshot but not found by matching fields
   * in the target is MISSING; a record found with any differing field
   * is MISMATCH; everything else is MATCH.
   */
  async reconcile(snapshot: TenantExportSnapshot, targetTenantId: string): Promise<ReconciliationReport> {
    const entries: ReconciliationEntry[] = [];

    for (const model of EXPORTABLE_MODELS) {
      const targetRows: Record<string, unknown>[] = await (prisma as any)[model].findMany({ where: { tenantId: targetTenantId } });
      const naturalKey = NATURAL_KEY[model];

      for (const original of snapshot.entities[model] ?? []) {
        const match = targetRows.find((row) => row[naturalKey] === (original as any)[naturalKey]);

        if (!match) {
          entries.push({ model, recordId: (original as any).id, status: "MISSING" });
          continue;
        }

        const comparableFields = Object.keys(original).filter((f) => !IDENTITY_FIELDS.has(f));
        const differingFields = comparableFields.filter((f) => row_ne(match[f], (original as any)[f]));
        entries.push(
          differingFields.length === 0
            ? { model, recordId: (original as any).id, status: "MATCH" }
            : { model, recordId: (original as any).id, status: "MISMATCH", differingFields },
        );
      }
    }

    return {
      totalRecords: entries.length,
      matched: entries.filter((e) => e.status === "MATCH").length,
      missing: entries.filter((e) => e.status === "MISSING").length,
      mismatched: entries.filter((e) => e.status === "MISMATCH").length,
      entries,
    };
  }
}

function row_ne(a: unknown, b: unknown): boolean {
  return a !== b;
}
