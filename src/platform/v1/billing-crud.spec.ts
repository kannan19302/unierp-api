import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPlans: any[] = [];
const mockSubscriptions: any[] = [];
const mockInvoices: any[] = [];

vi.mock("@kannan19302/database", () => ({
  prisma: {
    $transaction: vi.fn(async (callback: any) => {
      return callback({
        saaSPlan: {
          update: vi.fn(async ({ where, data }: any) => {
            const p = mockPlans.find((x) => x.id === where.id);
            if (p) Object.assign(p, data);
            return p;
          }),
        },
      });
    }),
    saaSPlan: {
      findMany: vi.fn(async () => mockPlans),
      findUniqueOrThrow: vi.fn(async ({ where }: any) => mockPlans.find((x) => x.id === where.id)),
      update: vi.fn(async ({ where, data }: any) => {
        const p = mockPlans.find((x) => x.id === where.id);
        if (p) Object.assign(p, data);
        return p;
      }),
    },
    tenantSubscription: {
      findMany: vi.fn(async ({ skip = 0, take = 25 }: any) => mockSubscriptions.slice(skip, skip + take)),
      count: vi.fn(async () => mockSubscriptions.length),
      findUnique: vi.fn(async ({ where }: any) => mockSubscriptions.find((s) => s.tenantId === where.tenantId)),
    },
    saaSInvoice: {
      findMany: vi.fn(async ({ skip, take }: any) => {
        if (typeof skip === "number" && typeof take === "number") {
          return mockInvoices.slice(skip, skip + take);
        }
        return mockInvoices;
      }),
      count: vi.fn(async () => mockInvoices.length),
      findUniqueOrThrow: vi.fn(async ({ where }: any) => mockInvoices.find((inv) => inv.id === where.id)),
    },
  },
}));

vi.mock("./control-plane-audit.service", () => ({
  ControlPlaneAuditService: vi.fn().mockImplementation(() => ({
    record: vi.fn().mockResolvedValue(true),
  })),
}));

import { PlansService } from "./plans.service";
import { SubscriptionManagementService } from "./subscription-management.service";
import { InvoicingService } from "./invoicing.service";
import { ControlPlaneAuditService } from "./control-plane-audit.service";

describe("Billing & Revenue Services", () => {
  let plansService: PlansService;
  let subService: SubscriptionManagementService;
  let invoiceService: InvoicingService;
  let auditService: ControlPlaneAuditService;

  beforeEach(() => {
    mockPlans.length = 0;
    mockSubscriptions.length = 0;
    mockInvoices.length = 0;

    // Seed test data
    mockPlans.push({
      id: "plan-growth",
      name: "Growth Plan",
      status: "ACTIVE",
      maxUsers: 25,
      version: 1,
    });

    mockSubscriptions.push({
      id: "sub-1",
      tenantId: "tenant-acme",
      planId: "plan-growth",
      status: "ACTIVE",
      billingPeriod: "MONTHLY",
      currency: "USD",
      createdAt: new Date(),
    });

    mockInvoices.push({
      id: "inv-1",
      tenantId: "tenant-acme",
      invoiceNumber: "INV-ACME-001",
      status: "PAID",
      totalAmount: 299,
      createdAt: new Date(),
      lines: [],
    });

    auditService = new ControlPlaneAuditService() as any;
    plansService = new PlansService(auditService);
    subService = new SubscriptionManagementService(auditService);
    invoiceService = new InvoicingService(auditService);
  });

  it("archives an existing plan without hard-deleting", async () => {
    const archived = await plansService.archivePlan("plan-growth", "admin-1");
    expect(archived.status).toBe("ARCHIVED");
    expect(mockPlans[0].status).toBe("ARCHIVED");
  });

  it("lists all tenant subscriptions with pagination metadata", async () => {
    const result = await subService.listSubscriptions({ page: 1, pageSize: 10 });
    expect(result.data.length).toBe(1);
    expect(result.total).toBe(1);
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(10);
    expect(result.data[0].tenantId).toBe("tenant-acme");
  });

  it("lists invoices with pagination support", async () => {
    const paginated = (await invoiceService.listInvoices(undefined, undefined, {
      page: 1,
      pageSize: 10,
    })) as any;

    expect(paginated.data.length).toBe(1);
    expect(paginated.total).toBe(1);
    expect(paginated.data[0].invoiceNumber).toBe("INV-ACME-001");
  });
});
