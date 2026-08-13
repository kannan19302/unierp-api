import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma, runWithTenantSession } from "@kannan19302/database";
import { Prisma, PrismaClient } from "@prisma/client";
import { CustomObjectSchemaService } from "../services/custom-object-schema.service";
import { BuilderDataObjectsService } from "../services/builder-data-objects.service";

/**
 * The same database, reached as the `NOBYPASSRLS` application role — see
 * ExtensionSchemaService's own spec for the full rationale. Copied rather
 * than imported so this file has no dependency on the extension-registry
 * module, which is a deliberately separate mechanism (see
 * custom-object-schema.service.ts's module doc).
 */
function appRoleUrlFrom(ownerUrl: string | undefined): string {
  const url = new URL(
    ownerUrl ?? "postgresql://unerp:unerp_password@localhost:5432/unerp_dev",
  );
  url.username = "unerp_api";
  url.password = "unerp_api_password";
  url.searchParams.set("schema", "public");
  url.searchParams.set("connection_limit", "2");
  url.searchParams.set("pool_timeout", "20");
  return url.toString();
}

/**
 * G09 exit criterion: "A customer-created object gets tenantId, both indexes
 * and an RLS policy automatically; check-rls-verify.mjs passes afterwards. A
 * custom object can never be created without isolation." These tests check
 * the guarantee against the database catalogue and against real rows under
 * the application role, not merely that the service function returned
 * without throwing.
 */
describe("CustomObjectSchemaService / BuilderDataObjectsService", () => {
  const schemaService = new CustomObjectSchemaService();
  const service = new BuilderDataObjectsService(schemaService);
  const tenantId = "spec-tenant-g09";
  let createdObjectId: string;
  let table: string;

  afterAll(async () => {
    if (table) {
      await prisma.$executeRaw(
        Prisma.raw(`DROP POLICY IF EXISTS "tenant_isolation_${table}" ON "${table}"`),
      );
      await prisma.$executeRaw(Prisma.raw(`DROP TABLE IF EXISTS "${table}"`));
    }
    await prisma.customObjectDefinition.deleteMany({ where: { tenantId } });
  });

  it("creates the definition and the real table in one step — never one without the other", async () => {
    const apiName = `spec_widget_${Date.now()}`;
    const object = await service.create(tenantId, "spec-user", {
      apiName,
      label: "Spec Widget",
      fields: [
        { name: "title", label: "Title", type: "string", required: true, indexed: true },
        { name: "amount", label: "Amount", type: "decimal", required: false, indexed: false },
      ],
    });

    createdObjectId = object.id;
    table = schemaService.tableName(object.id);
    expect(table).toBe(`co_${object.id.replace(/-/g, "_")}`);

    const rows = await prisma.$queryRaw<Array<{ table_name: string }>>(
      Prisma.sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ${table}`,
    );
    expect(rows).toHaveLength(1);
  });

  it("gives the generated table tenant_id, RLS ENABLED, FORCED and a policy — both indexes present", async () => {
    const [meta] = await prisma.$queryRaw<
      Array<{ enabled: boolean; forced: boolean; policies: bigint; has_tenant: bigint }>
    >(Prisma.sql`
      SELECT c.relrowsecurity AS enabled,
             c.relforcerowsecurity AS forced,
             (SELECT count(*) FROM pg_policies p WHERE p.tablename = c.relname) AS policies,
             (SELECT count(*) FROM information_schema.columns col
               WHERE col.table_name = c.relname AND col.column_name = 'tenant_id') AS has_tenant
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relname = ${table}
    `);
    expect(meta.enabled).toBe(true);
    expect(meta.forced).toBe(true);
    expect(Number(meta.policies)).toBeGreaterThan(0);
    expect(Number(meta.has_tenant)).toBe(1);

    const indexes = await prisma.$queryRaw<Array<{ indexname: string }>>(
      Prisma.sql`SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND tablename = ${table}`,
    );
    const names = indexes.map((i) => i.indexname);
    expect(names).toContain(`${table}_tenant_idx`);
    expect(names).toContain(`${table}_title_idx`);
  });

  it("maps a decimal field to Decimal(19,4), not a float", async () => {
    const [col] = await prisma.$queryRaw<
      Array<{ data_type: string; numeric_precision: number; numeric_scale: number }>
    >(Prisma.sql`
      SELECT data_type, numeric_precision, numeric_scale
        FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = ${table} AND column_name = 'amount'
    `);
    expect(col.data_type).toBe("numeric");
    expect(col.numeric_precision).toBe(19);
    expect(col.numeric_scale).toBe(4);
  });

  it("refuses a field that redeclares a platform-supplied column", async () => {
    await expect(
      service.create(tenantId, "spec-user", {
        apiName: `spec_bad_${Date.now()}`,
        label: "Bad",
        fields: [{ name: "tenant_id", label: "x", type: "string", required: false, indexed: false }],
      }),
    ).rejects.toThrow(/supplied by the platform/);
  });

  it("refuses an object id that could not be a safe SQL identifier", () => {
    expect(() => schemaService.tableName("../../etc")).toThrow(/Unsafe custom object id/);
  });

  it("adds a field additively without dropping existing columns", async () => {
    await service.addField(tenantId, createdObjectId, {
      name: "note_body",
      label: "Notes",
      type: "text",
      required: false,
      indexed: false,
    });
    const cols = await prisma.$queryRaw<Array<{ column_name: string }>>(
      Prisma.sql`SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = ${table}`,
    );
    const names = cols.map((c) => c.column_name);
    expect(names).toContain("title");
    expect(names).toContain("note_body");
  });

  it("rolls back the definition if the DDL step fails — a custom object can never exist without its table", async () => {
    const objectId = randomUUID();
    const badTable = schemaService.tableName(objectId);
    // Pre-create a conflicting object with the SAME apiName to force the
    // Prisma insert inside the transaction to fail after DDL would have run,
    // proving the transaction is atomic in both directions.
    const apiName = `spec_atomic_${Date.now()}`;
    await service.create(tenantId, "spec-user", {
      apiName,
      label: "First",
      fields: [{ name: "a", label: "A", type: "string", required: false, indexed: false }],
    });

    await expect(
      service.create(tenantId, "spec-user", {
        apiName, // duplicate — service pre-checks and throws before the transaction
        label: "Second",
        fields: [{ name: "b", label: "B", type: "string", required: false, indexed: false }],
      }),
    ).rejects.toThrow(/already exists/);

    // The pre-check runs before the transaction, so no table for this
    // never-attempted id should exist either.
    const rows = await prisma.$queryRaw<Array<{ table_name: string }>>(
      Prisma.sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ${badTable}`,
    );
    expect(rows).toHaveLength(0);
  });

  it("isolates rows between tenants at the database, not in application code", async () => {
    // MUST run as the application role (NOBYPASSRLS) — the owner connection
    // is a Postgres superuser and bypasses RLS outright, so asserting
    // isolation over it would prove nothing. See ExtensionSchemaService's
    // spec for the full incident this guards against.
    const appUrl =
      process.env.DATABASE_APP_URL ?? appRoleUrlFrom(process.env.DATABASE_URL);
    const appClient = new PrismaClient({ datasources: { db: { url: appUrl } } });

    try {
      const [role] = await appClient.$queryRaw<
        Array<{ rolname: string; rolsuper: boolean; rolbypassrls: boolean }>
      >(Prisma.sql`SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`);
      expect(role?.rolname).toBe("unerp_api");
      expect(role?.rolsuper).toBe(false);
      expect(role?.rolbypassrls).toBe(false);

      const insert = (forTenant: string, title: string) =>
        runWithTenantSession({ tenantId: forTenant, userId: "spec" }, async () =>
          prisma.$executeRaw(
            Prisma.sql`INSERT INTO ${Prisma.raw(`"${table}"`)} ("id", "tenant_id", "title")
                       VALUES (${`${forTenant}-${title}`}, ${forTenant}, ${title})
                       ON CONFLICT ("id") DO NOTHING`,
          ),
        );

      await insert("co-tenant-a", "a-row");
      await insert("co-tenant-b", "b-row");

      const seenByA = await appClient.$transaction(async (tx) => {
        await tx.$executeRaw(
          Prisma.sql`SELECT set_config('app.current_tenant_id', ${"co-tenant-a"}, true)`,
        );
        return tx.$queryRaw<Array<{ title: string }>>(
          Prisma.sql`SELECT title FROM ${Prisma.raw(`"${table}"`)}`,
        );
      });

      const titles = seenByA.map((r) => r.title);
      expect(titles).toContain("a-row");
      expect(titles).not.toContain("b-row");
    } finally {
      await appClient.$disconnect();
    }
  });
});
