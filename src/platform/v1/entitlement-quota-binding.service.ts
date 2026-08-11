/**
 * M29 (quota-binding half) — "an entitlement change in C13 changes the
 * resource quota, proven by asserting the quota after a plan change."
 * C13's entitlements are `SaaSPlan.maxUsers/maxStorage/maxApiCalls`; this
 * service reads whichever plan a tenant subscribes to NOW and writes
 * those three numbers as an M07 resource's desired state — through M09's
 * plan pipeline, the same discipline every other Track M mutation uses.
 */
import { Injectable, NotFoundException } from "@nestjs/common";
import { prisma } from "@kannan19302/database";
import { ResourceModelService } from "../resource-model/resource-model.service";
import { PlanningService } from "../operation-pipeline/planning.service";

const QUOTA_RESOURCE_KIND = "tenant-entitlement-quota";

export interface EntitlementQuota {
  maxUsers: number;
  maxStorage: number;
  maxApiCalls: number;
}

@Injectable()
export class EntitlementQuotaBindingService {
  constructor(
    private readonly resources: ResourceModelService,
    private readonly planning: PlanningService,
  ) {}

  private async getOrCreateQuotaResource(tenantId: string) {
    await this.resources.registerResourceKind(QUOTA_RESOURCE_KIND, "A tenant's resource quota, bound to its current plan entitlements");
    const { items } = await this.resources.searchResources({ kindName: QUOTA_RESOURCE_KIND, limit: 100 });
    const existing = items.find((r) => r.name === tenantId);
    if (existing) return existing;
    return this.resources.createResource(QUOTA_RESOURCE_KIND, tenantId, { maxUsers: 0, maxStorage: 0, maxApiCalls: 0 });
  }

  /**
   * Reads the tenant's CURRENT subscription's plan entitlements and
   * writes them as this resource's desired state via the plan pipeline —
   * called whenever C13's entitlements change under a tenant (a plan
   * upgrade/downgrade), never as a direct field write.
   */
  async syncQuotaFromEntitlements(tenantId: string): Promise<{ resourceId: string; quota: EntitlementQuota }> {
    const subscription = await (prisma as any).tenantSubscription.findFirst({
      where: { tenantId, status: "ACTIVE" },
      include: { plan: true },
    });
    if (!subscription?.plan) {
      throw new NotFoundException(`No active subscription/plan found for tenant "${tenantId}"`);
    }

    const quota: EntitlementQuota = {
      maxUsers: subscription.plan.maxUsers,
      maxStorage: subscription.plan.maxStorage,
      maxApiCalls: subscription.plan.maxApiCalls,
    };

    const resource = await this.getOrCreateQuotaResource(tenantId);
    // A real plan, compiled and applied — not a bypass of M09 just
    // because the change originates from C13 rather than the console.
    await this.planning.createPlan(resource.id, quota as unknown as Record<string, unknown>);
    await this.resources.setDesiredState(resource.id, quota as unknown as Record<string, unknown>);

    return { resourceId: resource.id, quota };
  }

  async getCurrentQuota(tenantId: string): Promise<EntitlementQuota | null> {
    const { items } = await this.resources.searchResources({ kindName: QUOTA_RESOURCE_KIND, limit: 100 });
    const resource = items.find((r) => r.name === tenantId);
    if (!resource) return null;
    const desired = await this.resources.getDesiredState(resource.id);
    return (desired?.state as EntitlementQuota) ?? null;
  }
}
