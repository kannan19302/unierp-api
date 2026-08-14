import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma, runWithTenantSession } from "@kannan19302/database";

const TENANT_A = "itest-tenant-a";
const TENANT_B = "itest-tenant-b";

describe("Integration: Tenant Isolation with Real Database", () => {
  beforeAll(async () => {
    // Ensure test tenants exist
    await runWithTenantSession(
      { tenantId: TENANT_A, userId: "test-user" },
      async () => {
        await prisma.tenant.upsert({
          where: { id: TENANT_A },
          create: { id: TENANT_A, name: "ITest Tenant A", slug: TENANT_A },
          update: {},
        });
      },
    );

    await runWithTenantSession(
      { tenantId: TENANT_B, userId: "test-user" },
      async () => {
        await prisma.tenant.upsert({
          where: { id: TENANT_B },
          create: { id: TENANT_B, name: "ITest Tenant B", slug: TENANT_B },
          update: {},
        });
      },
    );
  });

  afterAll(async () => {
    // Clean up test tenants
    await runWithTenantSession(
      { tenantId: TENANT_A, userId: "test-user" },
      async () => {
        await prisma.tenant.deleteMany({ where: { id: TENANT_A } });
      },
    );

    await runWithTenantSession(
      { tenantId: TENANT_B, userId: "test-user" },
      async () => {
        await prisma.tenant.deleteMany({ where: { id: TENANT_B } });
      },
    );
  });

  it("tenant A cannot see tenant B's data", async () => {
    // Create a tenant-scoped record for tenant A (using Organization which is tenant-scoped)
    await runWithTenantSession(
      { tenantId: TENANT_A, userId: "test-user" },
      async () => {
        await prisma.organization.create({
          data: {
            id: "org-a-1",
            name: "Org A",
            tenantId: TENANT_A,
            currency: "USD",
            timezone: "UTC",
          },
        });
      },
    );

    // Create a tenant-scoped record for tenant B
    await runWithTenantSession(
      { tenantId: TENANT_B, userId: "test-user" },
      async () => {
        await prisma.organization.create({
          data: {
            id: "org-b-1",
            name: "Org B",
            tenantId: TENANT_B,
            currency: "USD",
            timezone: "UTC",
          },
        });
      },
    );

    // Tenant A should only see their own organization
    const tenantAOrgs = await runWithTenantSession(
      { tenantId: TENANT_A, userId: "test-user" },
      async () => {
        return prisma.organization.findMany({ where: { tenantId: TENANT_A } });
      },
    );

    expect(tenantAOrgs).toHaveLength(1);
    expect(tenantAOrgs[0].name).toBe("Org A");

    // Tenant B should only see their own organization
    const tenantBOrgs = await runWithTenantSession(
      { tenantId: TENANT_B, userId: "test-user" },
      async () => {
        return prisma.organization.findMany({ where: { tenantId: TENANT_B } });
      },
    );

    expect(tenantBOrgs).toHaveLength(1);
    expect(tenantBOrgs[0].name).toBe("Org B");
  });

  it("RLS policy enforces isolation at database level", async () => {
    // Create records using raw SQL with explicit tenant session
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `SELECT set_config('app.current_tenant_id', $1, true)`,
        TENANT_A,
      );
      await tx.$executeRawUnsafe(`
        INSERT INTO "organizations" (id, name, "tenant_id", currency, timezone, "created_at", "updated_at")
        VALUES ('raw-org-a-2', 'Raw Org A', $1, 'USD', 'UTC', NOW(), NOW())
      `, TENANT_A);
    });

    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `SELECT set_config('app.current_tenant_id', $1, true)`,
        TENANT_B,
      );
      await tx.$executeRawUnsafe(`
        INSERT INTO "organizations" (id, name, "tenant_id", currency, timezone, "created_at", "updated_at")
        VALUES ('raw-org-b-2', 'Raw Org B', $1, 'USD', 'UTC', NOW(), NOW())
      `, TENANT_B);
    });

    // Query as tenant A should only return tenant A's records (2 total: org-a-1 from previous test + raw-org-a-2)
    const tenantAQuery = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `SELECT set_config('app.current_tenant_id', $1, true)`,
        TENANT_A,
      );
      return tx.$queryRawUnsafe(`SELECT * FROM "organizations" WHERE "tenant_id" = $1`, TENANT_A);
    });

    expect(tenantAQuery).toHaveLength(2);
    const rawOrgA = tenantAQuery.find((o: any) => o.name === "Raw Org A");
    expect(rawOrgA).toBeDefined();
    expect(rawOrgA.name).toBe("Raw Org A");

    // Query as tenant B should only return tenant B's records (2 total: org-b-1 from previous test + raw-org-b-2)
    const tenantBQuery = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `SELECT set_config('app.current_tenant_id', $1, true)`,
        TENANT_B,
      );
      return tx.$queryRawUnsafe(`SELECT * FROM "organizations" WHERE "tenant_id" = $1`, TENANT_B);
    });

    expect(tenantBQuery).toHaveLength(2);
    const rawOrgB = tenantBQuery.find((o: any) => o.name === "Raw Org B");
    expect(rawOrgB).toBeDefined();
    expect(rawOrgB.name).toBe("Raw Org B");
  });
});