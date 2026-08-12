/**
 * K15 exit criterion (G-4): "A tenant exits fully unaided and receives
 * a deletion certificate. Verified by rehearsal, not by clause."
 *
 * offboardTenant() previously issued a cryptographically signed artefact
 * TYPED "DELETION_CERTIFICATE" with a `deletedAt` timestamp, but never
 * deleted any tenant data anywhere — no cascading delete, no purge job,
 * nothing. A signed, tamper-evident-looking legal artefact asserting a
 * false fact.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

let tenants: any[];
let exportJobs: any[];
let subscriptions: any[];

vi.mock("@kannan19302/database", () => ({
  prisma: {
    tenant: {
      findUniqueOrThrow: vi.fn(({ where }: any) => {
        const t = tenants.find((x) => x.id === where.id);
        if (!t) throw new Error("Tenant not found");
        return t;
      }),
      update: vi.fn(({ where, data }: any) => {
        const t = tenants.find((x) => x.id === where.id);
        Object.assign(t, data);
        return t;
      }),
    },
    dataExportJob: {
      create: vi.fn(({ data }: any) => {
        const row = { id: `exp-${exportJobs.length + 1}`, ...data };
        exportJobs.push(row);
        return row;
      }),
    },
    tenantSubscription: {
      updateMany: vi.fn(({ where, data }: any) => {
        const affected = subscriptions.filter(
          (s) => s.tenantId === where.tenantId && s.status !== "CANCELLED",
        );
        for (const s of affected) Object.assign(s, data);
        return { count: affected.length };
      }),
    },
    $transaction: vi.fn((fn: any) =>
      fn({
        tenant: {
          update: vi.fn(({ where, data }: any) => {
            const t = tenants.find((x) => x.id === where.id);
            Object.assign(t, data);
            return t;
          }),
        },
        dataExportJob: {
          create: vi.fn(({ data }: any) => {
            const row = { id: `exp-${exportJobs.length + 1}`, ...data };
            exportJobs.push(row);
            return row;
          }),
        },
        tenantSubscription: {
          updateMany: vi.fn(({ where, data }: any) => {
            const affected = subscriptions.filter(
              (s) => s.tenantId === where.tenantId && s.status !== "CANCELLED",
            );
            for (const s of affected) Object.assign(s, data);
            return { count: affected.length };
          }),
        },
      }),
    ),
  },
}));

import { TenantExportOffboardingService } from "../tenant-export-offboarding.service";

describe("K15 · TenantExportOffboardingService.offboardTenant() does not claim deletion it never performed", () => {
  let service: TenantExportOffboardingService;
  const audit = { record: vi.fn().mockResolvedValue("hash") };

  beforeEach(() => {
    tenants = [{ id: "t1", name: "Acme", slug: "acme", status: "ACTIVE" }];
    exportJobs = [];
    subscriptions = [{ tenantId: "t1", status: "ACTIVE" }];
    service = new TenantExportOffboardingService(audit as any);
  });

  it("does NOT issue an artefact claiming data was deleted", async () => {
    const result = await service.offboardTenant("t1", "Customer requested full account closure.", "admin-1");
    expect(result.offboardingReceipt.type).not.toBe("DELETION_CERTIFICATE");
    expect(result.offboardingReceipt.dataDeleted).toBe(false);
  });

  it("still does the real, honest parts: marks the tenant OFFBOARDED and cancels subscriptions", async () => {
    await service.offboardTenant("t1", "Customer requested full account closure.", "admin-1");
    expect(tenants[0].status).toBe("OFFBOARDED");
    expect(subscriptions[0].status).toBe("CANCELLED");
  });

  it("the signed receipt is internally consistent — signature covers the same dataDeleted:false claim", async () => {
    const result = await service.offboardTenant("t1", "Customer requested full account closure.", "admin-1");
    expect(result.offboardingReceipt.signature).toBeTruthy();
    expect(result.offboardingReceipt.dataRetentionNote).toMatch(/has not been deleted/i);
  });
});
