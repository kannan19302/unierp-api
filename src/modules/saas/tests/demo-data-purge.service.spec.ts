/**
 * D07 exit criterion (G-18 half): "Sample data is removable in one
 * action with no residue." DemoDataService.seedDemoData() never
 * recorded what it created — DemoDataRecord (a real, indexed model)
 * existed but had zero writers anywhere in the codebase — so there was
 * no removal method at all. This spec proves seedDemoData now tracks
 * every record it creates, and that purgeDemoData() removes exactly
 * those records and nothing else, leaving no residue.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

let tenants: any[];
let organizations: any[];
let customers: any[];
let vendors: any[];
let products: any[];
let demoDataRecords: any[];
let seq = 0;
const nextId = (p: string) => `${p}-${++seq}`;

function makeTxDelegate(store: any[], entityType: string) {
  return {
    create: vi.fn(({ data }: any) => {
      const row = { id: nextId(entityType), ...data };
      store.push(row);
      return row;
    }),
    deleteMany: vi.fn(({ where }: any) => {
      const before = store.length;
      const remaining = store.filter((r) => !where.id.in.includes(r.id));
      const removed = before - remaining.length;
      store.length = 0;
      store.push(...remaining);
      return { count: removed };
    }),
  };
}

vi.mock("@kannan19302/database", () => ({
  prisma: {
    tenant: {
      findUnique: vi.fn(({ where: { id } }: any) => tenants.find((t) => t.id === id) ?? null),
      update: vi.fn(({ where: { id }, data }: any) => { const row = tenants.find((t) => t.id === id)!; Object.assign(row, data); return row; }),
    },
    organization: {
      findFirst: vi.fn(({ where }: any) => organizations.find((o) => o.tenantId === where.tenantId) ?? null),
    },
    demoDataRecord: {
      findMany: vi.fn(({ where }: any) => demoDataRecords.filter((r) => r.tenantId === where.tenantId)),
      deleteMany: vi.fn(({ where }: any) => {
        const before = demoDataRecords.length;
        const remaining = demoDataRecords.filter((r) => r.tenantId !== where.tenantId);
        const removed = before - remaining.length;
        demoDataRecords.length = 0;
        demoDataRecords.push(...remaining);
        return { count: removed };
      }),
    },
    $transaction: vi.fn(async (cb: any) => {
      const tx = {
        $executeRaw: vi.fn(),
        tenant: {
          update: vi.fn(({ where: { id }, data }: any) => { const row = tenants.find((t) => t.id === id)!; Object.assign(row, data); return row; }),
        },
        customer: makeTxDelegate(customers, "customer"),
        vendor: makeTxDelegate(vendors, "vendor"),
        product: makeTxDelegate(products, "product"),
        demoDataRecord: {
          create: vi.fn(({ data }: any) => { const row = { id: nextId("ddr"), createdAt: new Date(), ...data }; demoDataRecords.push(row); return row; }),
          deleteMany: vi.fn(({ where }: any) => {
            const before = demoDataRecords.length;
            const remaining = demoDataRecords.filter((r) => r.tenantId !== where.tenantId);
            const removed = before - remaining.length;
            demoDataRecords.length = 0;
            demoDataRecords.push(...remaining);
            return { count: removed };
          }),
        },
      };
      return cb(tx);
    }),
  },
}));

import { DemoDataService } from "../demo-data.service";

describe("D07 · sample data is tracked on seed and removable in one action with no residue", () => {
  let demoData: DemoDataService;

  beforeEach(() => {
    vi.clearAllMocks();
    tenants = [{ id: "t1", demoDataLoaded: false, settings: { industry: "generic" } }];
    organizations = [{ id: "org-1", tenantId: "t1" }];
    customers = [];
    vendors = [];
    products = [];
    demoDataRecords = [];
    demoData = new DemoDataService();
  });

  it("SEEDING records every created row in DemoDataRecord — the tracking mechanism removal depends on", async () => {
    await demoData.seedDemoData("t1");

    expect(customers.length).toBeGreaterThan(0);
    expect(vendors.length).toBeGreaterThan(0);
    expect(products.length).toBeGreaterThan(0);

    const totalRealRows = customers.length + vendors.length + products.length;
    expect(demoDataRecords).toHaveLength(totalRealRows); // one tracking row per real row created
    expect(demoDataRecords.every((r: any) => r.tenantId === "t1")).toBe(true);
  });

  it("PURGES every tracked row with NO RESIDUE — the real rows AND the tracking rows are both gone", async () => {
    await demoData.seedDemoData("t1");
    expect(customers.length + vendors.length + products.length).toBeGreaterThan(0);

    await demoData.purgeDemoData("t1");

    expect(customers).toHaveLength(0);
    expect(vendors).toHaveLength(0);
    expect(products).toHaveLength(0);
    expect(demoDataRecords).toHaveLength(0); // no residue in the tracking table either

    const tenant = tenants.find((t) => t.id === "t1")!;
    expect(tenant.demoDataLoaded).toBe(false); // the flag itself resets, allowing re-seeding
  });

  it("purging a tenant with NO seeded data is a safe no-op, not an error", async () => {
    await expect(demoData.purgeDemoData("t1")).resolves.not.toThrow();
    expect(demoDataRecords).toHaveLength(0);
  });

  it("purging one tenant never touches another tenant's real or tracking rows", async () => {
    tenants.push({ id: "t2", demoDataLoaded: false, settings: {} });
    organizations.push({ id: "org-2", tenantId: "t2" });

    await demoData.seedDemoData("t1");
    await demoData.seedDemoData("t2");
    const t2RecordCountBefore = demoDataRecords.filter((r: any) => r.tenantId === "t2").length;
    const t2CustomerCountBefore = customers.filter((c: any) => c.tenantId === "t2").length;

    await demoData.purgeDemoData("t1");

    expect(demoDataRecords.filter((r: any) => r.tenantId === "t2")).toHaveLength(t2RecordCountBefore);
    expect(customers.filter((c: any) => c.tenantId === "t2")).toHaveLength(t2CustomerCountBefore);
  });
});
