import { Injectable } from "@nestjs/common";
import { prisma } from "@unerp/database";
import { TENANT_PLAN_LIMITS } from "./tenant-plan-limits";

const CACHE_TTL_MS = 60_000;
const CACHE_MAX_ENTRIES = 10_000;

/**
 * Resolves a tenant's plan. The session JWT carries no plan claim (it is
 * minted by the IdP with sid/userId/tenantId only), so every throttling
 * decision that varies by plan must read it from the tenants table. Results
 * are cached briefly; a plan change takes effect within one TTL.
 *
 * The tenants table has RLS disabled, so a plain lookup works even before the
 * per-tenant session is established (the throttler runs as a global guard,
 * ahead of the tenant interceptor).
 */
@Injectable()
export class TenantPlanService {
  private readonly cache = new Map<string, { plan: string; expiresAt: number }>();

  async getPlan(tenantId: string): Promise<string> {
    const cached = this.cache.get(tenantId);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.plan;
    }

    let plan = "free";
    try {
      const row = await prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { plan: true },
      });
      plan = row?.plan || "free";
    } catch {
      // Defensive: never let a lookup failure escalate into a request failure;
      // the throttler treats an unknown tenant as the cheapest (free) tier.
      plan = "free";
    }

    if (this.cache.size >= CACHE_MAX_ENTRIES) {
      this.cache.clear();
    }
    this.cache.set(tenantId, { plan, expiresAt: Date.now() + CACHE_TTL_MS });
    return plan;
  }

  /** Max concurrent report-engine queries a tenant may run (pool fairness). */
  async getQueryBudget(tenantId: string): Promise<number> {
    const plan = await this.getPlan(tenantId);
    return TENANT_PLAN_LIMITS[plan]?.concurrency ?? 1;
  }
}
