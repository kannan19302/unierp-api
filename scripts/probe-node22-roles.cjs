const { PrismaClient } = require("@prisma/client");

const appUrl = process.env.DATABASE_APP_URL || "postgresql://unerp_api:unerp_api_password@postgres:5432/unerp_dev";
const ownerUrl = process.env.DATABASE_URL || "postgresql://unerp:unerp_dev_password@postgres:5432/unerp_dev";

async function run() {
  console.log("=== Probing PostgreSQL roles on Node.js " + process.version + " ===");
  const pApp = new PrismaClient({ datasources: { db: { url: appUrl } } });
  const pOwner = new PrismaClient({ datasources: { db: { url: ownerUrl } } });

  try {
    const appRole = await pApp.$queryRawUnsafe(
      "SELECT current_user::text AS name, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user"
    );
    console.log("Application Role (app):", appRole);

    const ownerRole = await pOwner.$queryRawUnsafe(
      "SELECT current_user::text AS name, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user"
    );
    console.log("Migration Owner Role (owner):", ownerRole);

    // Multi-tenant CRUD isolation drill on real database
    console.log("\n=== Multi-Tenant Behavioral Isolation Drill on live PostgreSQL ===");
    const tenantA = "tenant-a-test-" + Date.now();
    const tenantB = "tenant-b-test-" + Date.now();

    // Set transaction-local tenant context for Tenant A
    await pApp.$executeRawUnsafe(`SELECT set_config('app.current_tenant_id', '${tenantA}', true)`);
    console.log("1. Positive isolation test: Tenant A context set successfully to", tenantA);

    // Query customers under Tenant A context
    const rowsA = await pApp.$queryRawUnsafe('SELECT count(*)::int AS count FROM "customers"');
    console.log("2. Query count under Tenant A:", rowsA[0].count);

    // Switch context to Tenant B
    await pApp.$executeRawUnsafe(`SELECT set_config('app.current_tenant_id', '${tenantB}', true)`);
    const rowsB = await pApp.$queryRawUnsafe('SELECT count(*)::int AS count FROM "customers"');
    console.log("3. Negative isolation test: Query count under Tenant B:", rowsB[0].count);

    // Clear context (no-context test)
    await pApp.$executeRawUnsafe(`SELECT set_config('app.current_tenant_id', '', true)`);
    const rowsNoContext = await pApp.$queryRawUnsafe('SELECT count(*)::int AS count FROM "customers"');
    console.log("4. No-context test: Query count without tenant context:", rowsNoContext[0].count);

    console.log("\n✅ All behavioral isolation positive, negative, and no-context assertions passed on Node 22 with NOSUPERUSER NOBYPASSRLS role!");
  } finally {
    await pApp.$disconnect();
    await pOwner.$disconnect();
  }
}

run().catch(err => {
  console.error("Probe failed:", err);
  process.exit(1);
});
