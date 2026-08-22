import { Injectable } from "@nestjs/common";

/** Process-local verified runtime-plan cache. Control-plane mutations call
 * invalidateTenant immediately; multi-cell deployments can replace this
 * implementation with the same interface backed by invalidation events. */
@Injectable()
export class RuntimePlanCacheService {
  private readonly entries = new Map<string, { expiresAt: number; plan: any }>();
  get(key: string) {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt > Date.now()) return entry.plan;
    this.entries.delete(key);
    return undefined;
  }
  set(key: string, plan: any, ttlMs = 60_000) { this.entries.set(key, { plan, expiresAt: Date.now() + ttlMs }); }
  invalidateTenant(tenantId: string) { for (const key of this.entries.keys()) if (key.startsWith(`${tenantId}:`)) this.entries.delete(key); }
}
