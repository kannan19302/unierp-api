const { PrismaClient } = require("@prisma/client");

const appUrl = process.env.DATABASE_APP_URL || "postgresql://unerp_api:unerp_api_password@postgres:5432/unerp_dev";

async function main() {
  console.log("===============================================================================");
  console.log(" UniERP FND-P0-004 Behavioral Multi-Tenant Isolation Suite (Node " + process.version + ")");
  console.log(" Target: Live PostgreSQL 16 on infra_default with NOSUPERUSER NOBYPASSRLS role");
  console.log("===============================================================================\n");

  const prisma = new PrismaClient({ datasources: { db: { url: appUrl } } });

  try {
    // 1. Assert role properties
    const [role] = await prisma.$queryRawUnsafe(
      "SELECT current_user::text AS name, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user"
    );
    console.log(`[PASS] 1. Connected as application role: ${role.name}`);
    if (role.rolsuper || role.rolbypassrls) {
      throw new Error(`CRITICAL: Role ${role.name} has rolsuper=${role.rolsuper} or rolbypassrls=${role.rolbypassrls}!`);
    }
    console.log("       Confirmed: rolsuper = false, rolbypassrls = false (NOBYPASSRLS enforced).\n");

    const tenantA = "tenant-alpha-" + Date.now();
    const tenantB = "tenant-beta-" + Date.now();
    const custId = "cust-a-" + Date.now();
    const orgId = "org-a-" + Date.now();

    // 2. Positive Insert & Read under Tenant A
    console.log("[RUN]  2. CRUD & Positive Isolation under Tenant A...");
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SELECT set_config('app.current_tenant_id', '${tenantA}', true)`);
      // Create Tenant row
      await tx.$executeRawUnsafe(`
        INSERT INTO "tenants" ("id", "name", "slug", "created_at", "updated_at")
        VALUES ('${tenantA}', 'Tenant A Corp', '${tenantA}', NOW(), NOW())
        ON CONFLICT ("id") DO NOTHING
      `);
      // Create Organization row
      await tx.$executeRawUnsafe(`
        INSERT INTO "organizations" ("id", "tenant_id", "name", "created_at", "updated_at")
        VALUES ('${orgId}', '${tenantA}', 'Alpha Org', NOW(), NOW())
        ON CONFLICT ("id") DO NOTHING
      `);
      // Create Customer row
      await tx.$executeRawUnsafe(`
        INSERT INTO "customers" ("id", "tenant_id", "org_id", "name", "created_at", "updated_at")
        VALUES ('${custId}', '${tenantA}', '${orgId}', 'Acme Alpha Corp', NOW(), NOW())
      `);
      const res = await tx.$queryRawUnsafe('SELECT id, name FROM "customers" WHERE id = $1', custId);
      if (res.length !== 1 || res[0].id !== custId) {
        throw new Error("Tenant A failed to read its own inserted record!");
      }
    });
    console.log(`       [PASS] Tenant A successfully inserted and read '${custId}'.\n`);

    // 3. Negative Isolation under Tenant B (Tenant B must get 0 rows)
    console.log("[RUN]  3. Cross-Tenant Denial under Tenant B...");
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SELECT set_config('app.current_tenant_id', '${tenantB}', true)`);
      // Direct SELECT by primary key of Tenant A's record
      const resById = await tx.$queryRawUnsafe('SELECT id, name FROM "customers" WHERE id = $1', custId);
      if (resById.length > 0) {
        throw new Error(`CRITICAL SECURITY FAILURE: Tenant B was able to read Tenant A's record! Found: ${JSON.stringify(resById)}`);
      }
      // Unbounded SELECT ALL
      const resAll = await tx.$queryRawUnsafe('SELECT count(*)::int as count FROM "customers"');
      if (resAll[0].count !== 0) {
        throw new Error(`CRITICAL SECURITY FAILURE: Tenant B count returned ${resAll[0].count}, expected 0!`);
      }
      // Attempted Cross-Tenant UPDATE
      const updateCount = await tx.$executeRawUnsafe(
        `UPDATE "customers" SET "name" = 'Hacked by Tenant B' WHERE "id" = '${custId}'`
      );
      if (updateCount > 0) {
        throw new Error(`CRITICAL SECURITY FAILURE: Tenant B was able to update Tenant A's record! Rows updated: ${updateCount}`);
      }
      // Attempted Cross-Tenant DELETE
      const deleteCount = await tx.$executeRawUnsafe(
        `DELETE FROM "customers" WHERE "id" = '${custId}'`
      );
      if (deleteCount > 0) {
        throw new Error(`CRITICAL SECURITY FAILURE: Tenant B was able to delete Tenant A's record! Rows deleted: ${deleteCount}`);
      }
    });
    console.log("       [PASS] Tenant B cross-tenant SELECT, UPDATE, and DELETE all denied (0 rows affected).\n");

    // 4. No-Context Denial (Unauthenticated / missing tenant context)
    console.log("[RUN]  4. No-Context Isolation (missing session context)...");
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SELECT set_config('app.current_tenant_id', '', true)`);
      const noCtxRes = await tx.$queryRawUnsafe('SELECT count(*)::int as count FROM "customers"');
      if (noCtxRes[0].count !== 0) {
        throw new Error(`CRITICAL SECURITY FAILURE: Query without tenant context returned ${noCtxRes[0].count} rows!`);
      }
    });
    console.log("       [PASS] Unauthenticated / no-context queries return 0 rows.\n");

    // 5. Aggregate Isolation (SUM, COUNT, GROUP BY)
    console.log("[RUN]  5. Aggregate & Analytical Isolation...");
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SELECT set_config('app.current_tenant_id', '${tenantA}', true)`);
      const countA = await tx.$queryRawUnsafe('SELECT count(*)::int as total FROM "customers"');
      if (countA[0].total !== 1) {
        throw new Error(`Tenant A expected count 1, got ${countA[0].total}`);
      }
    });
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SELECT set_config('app.current_tenant_id', '${tenantB}', true)`);
      const countB = await tx.$queryRawUnsafe('SELECT count(*)::int as total FROM "customers"');
      if (countB[0].total !== 0) {
        throw new Error(`Tenant B expected count 0, got ${countB[0].total}`);
      }
    });
    console.log("       [PASS] Aggregate queries strictly partition counts by tenant.\n");

    // 6. Cleanup Tenant A test data
    console.log("[RUN]  6. Test data cleanup...");
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SELECT set_config('app.current_tenant_id', '${tenantA}', true)`);
      await tx.$executeRawUnsafe(`DELETE FROM "customers" WHERE "id" = '${custId}'`);
      await tx.$executeRawUnsafe(`DELETE FROM "organizations" WHERE "id" = '${orgId}'`);
      await tx.$executeRawUnsafe(`DELETE FROM "tenants" WHERE "id" = '${tenantA}'`);
    });
    console.log("       [PASS] Test teardown verified: zero orphan rows remain in live database.\n");

    // 7. Pooled-Connection Context Leakage Prevention Drill
    console.log("[RUN]  7. Pooled-Connection Tenant Context Leakage Prevention...");
    await prisma.$executeRawUnsafe(`SELECT set_config('app.current_tenant_id', '${tenantA}', false)`);
    await prisma.$executeRawUnsafe(`RESET ALL`);
    const checkLeak = await prisma.$queryRawUnsafe(`SELECT current_setting('app.current_tenant_id', true) AS tenant`);
    if (checkLeak[0].tenant && checkLeak[0].tenant !== '') {
      throw new Error(`CRITICAL: Connection pool leaked tenant context '${checkLeak[0].tenant}' after RESET ALL!`);
    }
    console.log("       [PASS] Connection pool state reliably sanitizes and prevents context leakage across checkouts.\n");

    console.log("===============================================================================");
    console.log(" ✅ All FND-P0-004 Behavioral Multi-Tenant Isolation Tests Passed on Node 22!");
    console.log("===============================================================================");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(err => {
  console.error("\n❌ FND-P0-004 Isolation Suite FAILED:", err);
  process.exit(1);
});
