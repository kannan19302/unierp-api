import { execSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { join } from "node:path";

const TEST_DB_URL = process.env.DATABASE_URL ?? "postgresql://unerp:unerp_password@localhost:5432/unerp_test?schema=public";
const TEST_DB_NAME = "unerp_test";
const WORKSPACE_ROOT = join(process.cwd(), "..");
// The database package is part of this monorepo. Keeping this derived from
// the workspace root makes `pnpm test:integration` usable from a clean clone
// instead of relying on an old sibling checkout named `unierp-data`.
const DATA_DIR = join(WORKSPACE_ROOT, "data");

export async function setupIntegrationTestDatabase(): Promise<void> {
  console.log("[integration-setup] Setting up test database...");

  // Create test database if it doesn't exist
  const adminUrl = TEST_DB_URL.replace(/\/unerp_test/, "/postgres");
  const adminPrisma = new PrismaClient({ datasources: { db: { url: adminUrl } } });

  try {
    // Always drop and recreate to ensure clean state (handles failed migrations)
    await adminPrisma.$executeRawUnsafe(`
      SELECT pg_terminate_backend(pid)
      FROM pg_stat_activity
      WHERE datname = '${TEST_DB_NAME}' AND pid <> pg_backend_pid()
    `);
    await adminPrisma.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${TEST_DB_NAME} WITH (FORCE)`);
    await adminPrisma.$executeRawUnsafe(`CREATE DATABASE ${TEST_DB_NAME}`);
    console.log("[integration-setup] Test database created fresh");
  } catch (error) {
    console.warn("[integration-setup] Could not create database:", error);
  } finally {
    await adminPrisma.$disconnect();
  }

  // Run migrations against test database
  process.env.DATABASE_URL = TEST_DB_URL;
  console.log("[integration-setup] Running migrations...");
  try {
    execSync("pnpm db:deploy", {
      cwd: DATA_DIR,
      stdio: "inherit",
      env: { ...process.env, DATABASE_URL: TEST_DB_URL },
    });
    console.log("[integration-setup] Migrations completed");
  } catch (error) {
    console.error("[integration-setup] Migration failed:", error);
    throw error;
  }

  // Seed test data
  console.log("[integration-setup] Seeding test data...");
  try {
    execSync("pnpm db:seed", {
      cwd: DATA_DIR,
      stdio: "inherit",
      env: { ...process.env, DATABASE_URL: TEST_DB_URL },
    });
    console.log("[integration-setup] Seeding completed");
  } catch (error) {
    console.warn("[integration-setup] Seeding failed (may be expected):", error);
  }
}

export async function teardownIntegrationTestDatabase(): Promise<void> {
  console.log("[integration-setup] Tearing down test database...");
  const adminUrl = TEST_DB_URL.replace(/\/unerp_test/, "/postgres");
  const adminPrisma = new PrismaClient({ datasources: { db: { url: adminUrl } } });

  try {
    // Terminate all connections to the test database
    await adminPrisma.$executeRawUnsafe(`
      SELECT pg_terminate_backend(pid)
      FROM pg_stat_activity
      WHERE datname = '${TEST_DB_NAME}' AND pid <> pg_backend_pid()
    `);
    // Force drop the database
    await adminPrisma.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${TEST_DB_NAME} WITH (FORCE)`);
    console.log("[integration-setup] Test database dropped");
  } catch (error) {
    console.warn("[integration-setup] Could not drop database:", error);
  } finally {
    await adminPrisma.$disconnect();
  }
}

export async function runIntegrationTests(): Promise<void> {
  console.log("[integration-setup] Running integration tests...");
  try {
    execSync("npx vitest run --config vitest.integration.config.ts", {
      cwd: process.cwd(),
      stdio: "inherit",
      env: { ...process.env, DATABASE_URL: TEST_DB_URL },
    });
    console.log("[integration-setup] Integration tests passed");
  } catch (error) {
    console.error("[integration-setup] Integration tests failed:", error);
    throw error;
  }
}

if (require.main === module) {
  const command = process.argv[2];

  switch (command) {
    case "setup":
      setupIntegrationTestDatabase().catch(() => process.exit(1));
      break;
    case "teardown":
      teardownIntegrationTestDatabase().catch(() => process.exit(1));
      break;
    case "run":
      runIntegrationTests().catch(() => process.exit(1));
      break;
    case "all":
      (async () => {
        await setupIntegrationTestDatabase();
        try {
          await runIntegrationTests();
        } finally {
          await teardownIntegrationTestDatabase();
        }
      })().catch(() => process.exit(1));
      break;
    default:
      console.error("Usage: tsx test/integration-setup.ts <setup|teardown|run|all>");
      process.exit(1);
  }
}
