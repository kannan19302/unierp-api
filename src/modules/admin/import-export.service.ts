import { Injectable } from "@nestjs/common";
import { prisma } from "@kannan19302/database";
import { idpClient as idpPrisma } from "@/common/idp-client";

interface ImportRow {
  [key: string]: unknown;
}

interface ValidationResult {
  valid: ImportRow[];
  errors: { row: number; field: string; message: string }[];
}

const MODEL_FIELDS: Record<string, { required: string[]; optional: string[] }> =
  {
    Customer: {
      required: ["name"],
      optional: [
        "type",
        "email",
        "phone",
        "taxId",
        "paymentTerms",
        "status",
        "notes",
      ],
    },
    Vendor: {
      required: ["name"],
      optional: [
        "type",
        "email",
        "phone",
        "taxId",
        "paymentTerms",
        "status",
        "notes",
      ],
    },
    Product: {
      required: ["sku", "name", "costPrice", "sellPrice"],
      optional: [
        "type",
        "description",
        "category",
        "brand",
        "unit",
        "barcode",
        "isActive",
      ],
    },
    Employee: {
      required: [
        "employeeCode",
        "firstName",
        "lastName",
        "email",
        "dateOfJoining",
      ],
      optional: ["phone", "designation", "employmentType", "status"],
    },
  };

@Injectable()
export class ImportExportService {
  async validateImport(
    _tenantId: string,
    targetModel: string,
    rows: ImportRow[],
  ): Promise<ValidationResult> {
    const schema = MODEL_FIELDS[targetModel];
    if (!schema) {
      return {
        valid: [],
        errors: [
          {
            row: 0,
            field: "_model",
            message: `Unsupported model: ${targetModel}`,
          },
        ],
      };
    }

    const valid: ImportRow[] = [];
    const errors: { row: number; field: string; message: string }[] = [];

    rows.forEach((row, idx) => {
      let rowValid = true;
      for (const field of schema.required) {
        if (!row[field] && row[field] !== 0) {
          errors.push({ row: idx + 1, field, message: `${field} is required` });
          rowValid = false;
        }
      }
      if (rowValid) valid.push(row);
    });

    return { valid, errors };
  }

  /**
   * D08 — all-or-nothing: 200 bad rows out of 10,000 must import
   * NOTHING, not the other 9,800. Two error sources, both refuse the
   * ENTIRE batch:
   *
   *   1. Schema validation (validateImport, upfront, no DB touched)
   *      catches missing required fields for every row before anything
   *      is attempted — every bad row reported with row+field+message.
   *   2. A single Prisma transaction wraps every row's create. A
   *      database-level failure on ANY row (e.g. a duplicate unique
   *      constraint that upfront field validation can't see) throws,
   *      which rolls back every row already inserted earlier in the
   *      SAME call — a batch never partially lands.
   *
   * Because nothing commits on failure, the same batch (corrected) is
   * always safely re-runnable — there is no partial state to reconcile
   * against first.
   */
  async executeImport(
    tenantId: string,
    orgId: string,
    targetModel: string,
    rows: ImportRow[],
  ): Promise<{ created: number; errors: { row: number; field?: string; message: string }[] }> {
    const modelMap: Record<string, string> = {
      Customer: "customer",
      Vendor: "vendor",
      Product: "product",
      Employee: "employee",
    };

    const prismaModel = modelMap[targetModel];
    if (!prismaModel) {
      return {
        created: 0,
        errors: [{ row: 0, message: `Unsupported model: ${targetModel}` }],
      };
    }

    // Phase 1: schema validation across the WHOLE batch, upfront. Any
    // failure here refuses the batch before a single row is attempted.
    const validation = await this.validateImport(tenantId, targetModel, rows);
    if (validation.errors.length > 0) {
      return { created: 0, errors: validation.errors };
    }

    // Phase 2: one transaction for the whole batch. A DB-level failure
    // on any row (e.g. a unique-constraint violation validateImport
    // cannot see) throws out of the transaction, rolling back every
    // row already created earlier in this same call.
    try {
      const created = await prisma.$transaction(async (tx) => {
        let count = 0;
        for (const row of rows) {
          const data: any = { ...row, tenantId, orgId };
          if (targetModel === "Product") {
            if (data.costPrice) data.costPrice = parseFloat(data.costPrice);
            if (data.sellPrice) data.sellPrice = parseFloat(data.sellPrice);
          }
          if (data.paymentTerms) data.paymentTerms = parseInt(data.paymentTerms, 10);

          await (tx as any)[prismaModel].create({ data });
          count++;
        }
        return count;
      });

      return { created, errors: [] };
    } catch (err: any) {
      return { created: 0, errors: [{ row: 0, message: `Import refused, nothing committed: ${err.message || "Unknown error"}` }] };
    }
  }

  async exportData(
    tenantId: string,
    entityType: string,
    format: string,
    filters: { startDate?: string; endDate?: string },
  ): Promise<unknown[]> {
    const modelMap: Record<string, string> = {
      customers: "customer",
      vendors: "vendor",
      products: "product",
      employees: "employee",
      invoices: "invoice",
    };

    const prismaModel = modelMap[entityType];
    if (!prismaModel) return [];

    const where: any = { tenantId };
    if (filters.startDate) {
      where.createdAt = {
        ...(where.createdAt || {}),
        gte: new Date(filters.startDate),
      };
    }
    if (filters.endDate) {
      where.createdAt = {
        ...(where.createdAt || {}),
        lte: new Date(filters.endDate),
      };
    }

    const records = await (prisma as any)[prismaModel].findMany({
      where,
      take: 10000,
    });

    if (format === "csv") {
      // Return raw records — controller will convert to CSV
      return records;
    }

    return records;
  }

  async getImportHistory(tenantId: string) {
    // Return recent audit logs related to imports
    const logs = await prisma.auditLog.findMany({
      where: { tenantId, action: { in: ["IMPORT", "BULK_CREATE"] } },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return logs;
  }
}
