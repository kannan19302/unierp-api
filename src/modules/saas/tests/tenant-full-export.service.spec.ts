/**
 * D10 exit criterion: "The export re-imports into a clean instance and
 * reconciles record-for-record. Requested by the tenant, delivered
 * without our involvement."
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

let customers: any[];
let vendors: any[];
let products: any[];
let employees: any[];
let seq = 0;

function makeDelegate(store: any[]) {
  return {
    findMany: vi.fn(({ where }: any) => store.filter((r) => r.tenantId === where.tenantId)),
    count: vi.fn(({ where }: any) => store.filter((r) => r.tenantId === where.tenantId).length),
    create: vi.fn(({ data }: any) => { const row = { id: `id-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data }; store.push(row); return row; }),
  };
}

vi.mock("@kannan19302/database", () => ({
  prisma: {
    get customer() { return makeDelegate(customers); },
    get vendor() { return makeDelegate(vendors); },
    get product() { return makeDelegate(products); },
    get employee() { return makeDelegate(employees); },
  },
}));

import { TenantFullExportService } from "../tenant-full-export.service";

describe("D10 · complete tenant export — round-trips into a clean instance, reconciles record-for-record", () => {
  let exportSvc: TenantFullExportService;

  beforeEach(() => {
    vi.clearAllMocks();
    customers = [];
    vendors = [];
    products = [];
    employees = [];
    seq = 0;
    exportSvc = new TenantFullExportService();

    customers.push(
      { id: "c1", tenantId: "t-src", orgId: "org-src", name: "Acme Corp", email: "acme@example.com", createdAt: new Date(), updatedAt: new Date() },
      { id: "c2", tenantId: "t-src", orgId: "org-src", name: "Globex", email: "globex@example.com", createdAt: new Date(), updatedAt: new Date() },
    );
    vendors.push({ id: "v1", tenantId: "t-src", orgId: "org-src", name: "Supplier One", email: "supplier@example.com", createdAt: new Date(), updatedAt: new Date() });
    products.push({ id: "p1", tenantId: "t-src", orgId: "org-src", sku: "SKU-1", name: "Widget", costPrice: 5, sellPrice: 10, createdAt: new Date(), updatedAt: new Date() });
    employees.push({ id: "e1", tenantId: "t-src", orgId: "org-src", employeeCode: "EMP-1", firstName: "Jane", lastName: "Doe", createdAt: new Date(), updatedAt: new Date() });
  });

  it("EXPORTS every owned row across all entity types", async () => {
    const snapshot = await exportSvc.exportTenant("t-src");
    expect(snapshot.entities.customer).toHaveLength(2);
    expect(snapshot.entities.vendor).toHaveLength(1);
    expect(snapshot.entities.product).toHaveLength(1);
    expect(snapshot.entities.employee).toHaveLength(1);
  });

  it("RE-IMPORTS into a clean target instance", async () => {
    const snapshot = await exportSvc.exportTenant("t-src");
    const result = await exportSvc.importIntoCleanInstance(snapshot, "t-dst", "org-dst");

    expect(result.imported).toBe(5); // 2 customers + 1 vendor + 1 product + 1 employee
    expect(customers.filter((c) => c.tenantId === "t-dst")).toHaveLength(2);
    expect(vendors.filter((v) => v.tenantId === "t-dst")).toHaveLength(1);
  });

  it("REFUSES to import into a target that is not a clean instance", async () => {
    customers.push({ id: "existing", tenantId: "t-dst", orgId: "org-dst", name: "Pre-existing", email: "x@example.com" });
    const snapshot = await exportSvc.exportTenant("t-src");

    await expect(exportSvc.importIntoCleanInstance(snapshot, "t-dst", "org-dst")).rejects.toThrow(/not a clean instance/);
  });

  it("RECONCILES record-for-record: every original record matches its re-imported counterpart", async () => {
    const snapshot = await exportSvc.exportTenant("t-src");
    await exportSvc.importIntoCleanInstance(snapshot, "t-dst", "org-dst");

    const report = await exportSvc.reconcile(snapshot, "t-dst");

    expect(report.totalRecords).toBe(5);
    expect(report.matched).toBe(5);
    expect(report.missing).toBe(0);
    expect(report.mismatched).toBe(0);
  });

  it("reconciliation catches a MISSING record — an incomplete import is never reported as a clean match", async () => {
    const snapshot = await exportSvc.exportTenant("t-src");
    await exportSvc.importIntoCleanInstance(snapshot, "t-dst", "org-dst");
    // Simulate data loss: remove one imported row from the target.
    vendors.length = 0;

    const report = await exportSvc.reconcile(snapshot, "t-dst");
    expect(report.missing).toBe(1);
    expect(report.entries.find((e) => e.status === "MISSING")!.model).toBe("vendor");
  });

  it("reconciliation catches a MISMATCH — a field that changed after import is never reported as a clean match", async () => {
    const snapshot = await exportSvc.exportTenant("t-src");
    await exportSvc.importIntoCleanInstance(snapshot, "t-dst", "org-dst");
    // Simulate corruption: mutate a re-imported product's price.
    const importedProduct = products.find((p) => p.tenantId === "t-dst")!;
    importedProduct.sellPrice = 999;

    const report = await exportSvc.reconcile(snapshot, "t-dst");
    expect(report.mismatched).toBe(1);
    const mismatch = report.entries.find((e) => e.status === "MISMATCH")!;
    expect(mismatch.model).toBe("product");
    expect(mismatch.differingFields).toContain("sellPrice");
  });
});
