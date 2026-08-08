import { describe, it, expect, vi, beforeEach } from "vitest";
import { TenantPlanService } from "../tenant-plan.service";

vi.mock("@unerp/database", () => ({
  prisma: { tenant: { findUnique: vi.fn() } },
}));

import { prisma } from "@unerp/database";

describe("TenantPlanService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resolves the tenant plan and its concurrency budget from the database", async () => {
    (prisma.tenant.findUnique as any).mockResolvedValue({ plan: "business" });
    const svc = new TenantPlanService();

    expect(await svc.getPlan("t1")).toBe("business");
    expect(await svc.getQueryBudget("t1")).toBe(4);
  });

  it("caches the plan within the TTL so repeated lookups hit the DB once", async () => {
    (prisma.tenant.findUnique as any).mockResolvedValue({ plan: "free" });
    const svc = new TenantPlanService();

    await svc.getPlan("t1");
    await svc.getPlan("t1");
    await svc.getQueryBudget("t1");
    expect(prisma.tenant.findUnique).toHaveBeenCalledTimes(1);
  });

  it("defaults an unknown tenant to the free plan", async () => {
    (prisma.tenant.findUnique as any).mockResolvedValue(null);
    const svc = new TenantPlanService();

    expect(await svc.getPlan("t1")).toBe("free");
  });

  it("degrades to free when the lookup fails rather than failing the request", async () => {
    (prisma.tenant.findUnique as any).mockRejectedValue(new Error("db down"));
    const svc = new TenantPlanService();

    expect(await svc.getPlan("t1")).toBe("free");
  });

  it("gives an unknown plan the free concurrency budget", async () => {
    (prisma.tenant.findUnique as any).mockResolvedValue({ plan: "mega-enterprise" });
    const svc = new TenantPlanService();

    expect(await svc.getQueryBudget("t1")).toBe(1);
  });
});
