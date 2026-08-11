/**
 * M44 exit criterion: "An industry suite is composed, priced and
 * provisioned from the catalogue. An extension declaring an unsatisfied
 * capability cannot be approved in C25's review queue" (the second half
 * is proven in vendor.service.spec.ts / vendor-capability-gate.spec.ts).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

let resourceKinds: any[];
let resources: any[];
let desiredStates: any[];
let products: any[];
let suites: any[];
let suiteItems: any[];
let provisionings: any[];
let capabilityStates: Record<string, "READY" | "UNSATISFIED">;
let seq = 0;
const nextId = (p: string) => `${p}-${++seq}`;

vi.mock("@kannan19302/database", () => ({
  prisma: {
    resourceKind: {
      upsert: vi.fn(({ where, create }: any) => {
        let row = resourceKinds.find((k) => k.name === where.name);
        if (!row) { row = { id: nextId("kind"), ...create }; resourceKinds.push(row); }
        return row;
      }),
      findUnique: vi.fn(({ where: { name } }: any) => resourceKinds.find((k) => k.name === name) ?? null),
    },
    resource: {
      create: vi.fn(({ data }: any) => { const row = { id: nextId("res"), ...data }; resources.push(row); return row; }),
    },
    desiredState: {
      findUnique: vi.fn(({ where: { resourceId } }: any) => desiredStates.find((d) => d.resourceId === resourceId) ?? null),
      upsert: vi.fn(({ where: { resourceId }, create }: any) => {
        let row = desiredStates.find((d) => d.resourceId === resourceId);
        if (!row) { row = { id: nextId("ds"), ...create }; desiredStates.push(row); } else Object.assign(row, create);
        return row;
      }),
    },
    desiredStateVersion: { create: vi.fn(() => ({})) },
    catalogueProduct: {
      findUnique: vi.fn(({ where: { id } }: any) => products.find((p) => p.id === id) ?? null),
    },
    catalogueSuite: {
      findUnique: vi.fn(({ where: { id } }: any) => suites.find((s) => s.id === id) ?? null),
    },
    catalogueSuiteItem: {
      findMany: vi.fn(({ where }: any) => suiteItems.filter((i) => i.suiteId === where.suiteId)),
    },
    catalogueProvisioning: {
      create: vi.fn(({ data }: any) => { const row = { id: nextId("prov"), provisionedAt: new Date(), ...data }; provisionings.push(row); return row; }),
    },
  },
}));

vi.mock("@kannan19302/shared", () => ({
  resolve: (capabilityId: string) => ({ state: capabilityStates[capabilityId] ?? "UNSATISFIED" }),
}));

import { ResourceModelService } from "../resource-model/resource-model.service";
import { IndustrySuiteCatalogueService } from "./industry-suite-catalogue.service";

describe("M44 · industry suites — composed, priced and provisioned from the catalogue", () => {
  let resources_: ResourceModelService;
  let catalogue: IndustrySuiteCatalogueService;

  beforeEach(async () => {
    vi.clearAllMocks();
    resourceKinds = [];
    resources = [];
    desiredStates = [];
    products = [];
    suites = [];
    suiteItems = [];
    provisionings = [];
    capabilityStates = {};
    resources_ = new ResourceModelService();
    catalogue = new IndustrySuiteCatalogueService(resources_);
    await resources_.registerResourceKind("catalogue-suite-installation");
  });

  function addProduct(name: string, priceCents: number, capabilityId: string | null = null) {
    const product = { id: nextId("prod"), name, priceCents, capabilityId };
    products.push(product);
    return product;
  }
  function addSuite(name: string, productIds: string[]) {
    const suite = { id: nextId("suite"), name };
    suites.push(suite);
    for (const productId of productIds) suiteItems.push({ suiteId: suite.id, productId });
    return suite;
  }

  it("COMPOSES a suite's price by summing its products — never a second, hand-entered number", async () => {
    const crm = addProduct("CRM module", 5000);
    const invoicing = addProduct("Invoicing module", 3000);
    const suite = addSuite("Sales Suite", [crm.id, invoicing.id]);

    const composition = await catalogue.composeSuite(suite.id);

    expect(composition.totalPriceCents).toBe(8000);
    expect(composition.items.map((i) => i.name).sort()).toEqual(["CRM module", "Invoicing module"]);
  });

  it("PROVISIONS a satisfied suite: creates a real M07 resource and a provisioning record with the priced total", async () => {
    capabilityStates["email.send"] = "READY";
    const emailProduct = addProduct("Email notifications", 1000, "email.send");
    const suite = addSuite("Comms Suite", [emailProduct.id]);

    const result = await catalogue.provisionSuite(suite.id, "tenant-1");

    expect(result.resource.name).toContain(suite.id);
    expect(result.provisioning.totalPriceCents).toBe(1000);
    expect(result.provisioning.resourceId).toBe(result.resource.id);
    expect(resources).toHaveLength(1);
  });

  it("REFUSES to provision a suite containing an UNSATISFIED capability — never installs half-working", async () => {
    capabilityStates["dns.manage"] = "UNSATISFIED";
    const dnsProduct = addProduct("Custom domains", 2000, "dns.manage");
    const suite = addSuite("Domains Suite", [dnsProduct.id]);

    await expect(catalogue.provisionSuite(suite.id, "tenant-1")).rejects.toThrow(/unsatisfied capabilities/i);
    expect(resources).toHaveLength(0); // nothing was ever created
    expect(provisionings).toHaveLength(0);
  });

  it("a product with no declared capability is never checked against the registry — it just prices and provisions", async () => {
    const generic = addProduct("Generic add-on", 500, null);
    const suite = addSuite("Utility Suite", [generic.id]);

    const result = await catalogue.provisionSuite(suite.id, "tenant-1");
    expect(result.provisioning.totalPriceCents).toBe(500);
  });
});
