import { Injectable } from "@nestjs/common";
import { prisma } from "@kannan19302/database";
import { Prisma, type PrismaClient } from "@prisma/client";
import { IDENTIFIER, PG_TYPE, type FieldType } from "@kannan19302/extension-api";

/** A field as declared through the Data Object Builder — already Zod-validated by the caller. */
export interface CustomObjectFieldDdl {
  name: string;
  type: FieldType;
  required: boolean;
  indexed: boolean;
}

/**
 * Generates the real, per-object Postgres table for a tenant-defined custom
 * object — G09 ("Custom objects, fields, relationships, validation, indexes
 * and RLS — generated correctly, migrated safely").
 *
 * This mirrors `ExtensionSchemaService` (extension-registry module, G01/§8.2)
 * deliberately rather than being built from scratch: same safety argument,
 * same closed type map, same idempotent additive-upgrade shape. It is a
 * distinct service — not a call into extension-registry — because a custom
 * object is developer-portal-authored tenant data (one table, one owning
 * tenant), not an installable extension's shared multi-tenant table, and the
 * two should not become coupled just because the DDL pattern rhymes.
 *
 *   - Table name is `co_<objectId>`, produced only by `tableName()` below —
 *     never a string the caller supplies — and re-validated against
 *     `IDENTIFIER` at the point of interpolation.
 *   - Column names/types come from Zod-validated input (closed FIELD_TYPES
 *     map), re-checked against `IDENTIFIER` here as the last line of defence
 *     before DDL, same as the extension path.
 *   - No user *values* are interpolated — this builds structure only.
 *   - Every generated table gets tenant_id, RLS ENABLED and FORCED, and a
 *     tenant_isolation policy, same as a first-party table.
 *   - `provision()` is called from inside the SAME database transaction that
 *     writes the CustomObjectDefinition/Field rows (see
 *     BuilderDataObjectsService.createObject), so a definition can never
 *     exist without its backing table already isolated — Postgres DDL is
 *     transactional, so a failure here rolls back the definition too.
 */
@Injectable()
export class CustomObjectSchemaService {
  tableName(objectId: string): string {
    // `objectId` is a UUID and frequently starts with a digit, so the
    // leading-letter half of IDENTIFIER is validated against the table name
    // AFTER the `co_` prefix is applied — the same rule ExtensionSchemaService
    // applies, checking the string that actually reaches DDL rather than an
    // input that was never going to be interpolated on its own.
    const table = `co_${objectId.replace(/-/g, "_")}`;
    if (!IDENTIFIER.test(table)) {
      throw new Error(`Unsafe custom object id for DDL: ${objectId}`);
    }
    return table;
  }

  /**
   * Create the object's table, indexes and RLS policy. Runs on `tx` when
   * called from within a transaction so the definition write and the DDL
   * commit or roll back together.
   */
  async provision(
    tx: Pick<PrismaClient, "$executeRaw">,
    objectId: string,
    fields: CustomObjectFieldDdl[],
  ): Promise<string> {
    const table = this.tableName(objectId);
    await this.createTable(tx, table, fields);
    await this.applyRls(tx, table);
    return table;
  }

  /**
   * Additive field upgrade: a field added after creation appears as a new
   * column without touching existing rows or dropping anything, same rule
   * as an extension schema re-provision.
   */
  async addField(
    tx: Pick<PrismaClient, "$executeRaw">,
    objectId: string,
    field: CustomObjectFieldDdl,
  ): Promise<void> {
    const table = this.tableName(objectId);
    if (!IDENTIFIER.test(field.name)) {
      throw new Error(`Unsafe column name reached DDL: ${field.name}`);
    }
    await tx.$executeRaw(
      Prisma.raw(
        `ALTER TABLE "${table}" ADD COLUMN IF NOT EXISTS "${field.name}" ${PG_TYPE[field.type]}${field.required ? " NOT NULL DEFAULT ''" : ""}`,
      ),
    );
    if (field.indexed) {
      await tx.$executeRaw(
        Prisma.raw(
          `CREATE INDEX IF NOT EXISTS "${table}_${field.name}_idx" ON "${table}" ("tenant_id", "${field.name}")`,
        ),
      );
    }
  }

  /**
   * Deliberately NOT called from object deletion. Deleting a
   * CustomObjectDefinition removes the definition; reclaiming the data table
   * is a separate, deliberate purge — same rule as extension uninstall (G03).
   */
  async dropTable(objectId: string): Promise<void> {
    const table = this.tableName(objectId);
    await prisma.$executeRaw(
      Prisma.raw(`DROP POLICY IF EXISTS "tenant_isolation_${table}" ON "${table}"`),
    );
    await prisma.$executeRaw(Prisma.raw(`DROP TABLE IF EXISTS "${table}"`));
  }

  private async createTable(
    tx: Pick<PrismaClient, "$executeRaw">,
    table: string,
    fields: CustomObjectFieldDdl[],
  ): Promise<void> {
    const columns = fields.map((f) => {
      if (!IDENTIFIER.test(f.name)) {
        throw new Error(`Unsafe column name reached DDL: ${f.name}`);
      }
      return `"${f.name}" ${PG_TYPE[f.type]}${f.required ? " NOT NULL" : ""}`;
    });

    const ddl =
      `CREATE TABLE IF NOT EXISTS "${table}" (` +
      `"id" TEXT NOT NULL, ` +
      `"tenant_id" TEXT NOT NULL, ` +
      `${columns.join(", ")}${columns.length ? ", " : ""}` +
      `"created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, ` +
      `"updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, ` +
      `CONSTRAINT "${table}_pkey" PRIMARY KEY ("id"))`;

    await tx.$executeRaw(Prisma.raw(ddl));

    // Tenant index always; declared indexes on request — "both indexes" in
    // the exit criterion: the tenant index every generated table gets, and
    // the per-field index a declared `indexed` field gets.
    await tx.$executeRaw(
      Prisma.raw(
        `CREATE INDEX IF NOT EXISTS "${table}_tenant_idx" ON "${table}" ("tenant_id")`,
      ),
    );
    for (const f of fields.filter((x) => x.indexed)) {
      await tx.$executeRaw(
        Prisma.raw(
          `CREATE INDEX IF NOT EXISTS "${table}_${f.name}_idx" ON "${table}" ("tenant_id", "${f.name}")`,
        ),
      );
    }
  }

  private async applyRls(
    tx: Pick<PrismaClient, "$executeRaw">,
    table: string,
  ): Promise<void> {
    await tx.$executeRaw(Prisma.raw(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`));
    await tx.$executeRaw(Prisma.raw(`ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY`));
    await tx.$executeRaw(
      Prisma.raw(`DROP POLICY IF EXISTS "tenant_isolation_${table}" ON "${table}"`),
    );
    await tx.$executeRaw(
      Prisma.raw(
        `CREATE POLICY "tenant_isolation_${table}" ON "${table}" ` +
          `USING ("tenant_id" = current_tenant_id()) ` +
          `WITH CHECK ("tenant_id" = current_tenant_id())`,
      ),
    );
  }
}
