import { describe, expect, it, vi } from "vitest";
import { RuntimePlanCacheInvalidationService } from "./runtime-plan-cache-invalidation.service";
import { RuntimePlanCacheService } from "./runtime-plan-cache.service";

function client() {
  const handlers = new Map<string, (...args: any[]) => void>();
  return {
    connect: vi.fn(async () => undefined), disconnect: vi.fn(), publish: vi.fn(async () => 1), subscribe: vi.fn(async () => 1),
    on: vi.fn((event: string, handler: (...args: any[]) => void) => { handlers.set(event, handler); }), handlers,
  };
}

describe("RuntimePlanCacheInvalidationService", () => {
  it("broadcasts local emergency invalidation and consumes invalidations from another cell", async () => {
    const cache = new RuntimePlanCacheService();
    const publisher = client(); const subscriber = client();
    const service = new RuntimePlanCacheInvalidationService(cache, { publisher: publisher as any, subscriber: subscriber as any });
    await service.onModuleInit();

    cache.set("tenant-a:project:env", { release: "a" });
    await service.invalidateTenant("tenant-a");
    expect(cache.get("tenant-a:project:env")).toBeUndefined();
    expect(publisher.publish).toHaveBeenCalledWith("unierp:developer-runtime-plan:invalidate:v1", JSON.stringify({ tenantId: "tenant-a" }));

    cache.set("tenant-b:project:env", { release: "b" });
    subscriber.handlers.get("message")?.("unierp:developer-runtime-plan:invalidate:v1", JSON.stringify({ tenantId: "tenant-b" }));
    expect(cache.get("tenant-b:project:env")).toBeUndefined();
  });

  it("keeps the local eviction when the broadcast transport is down", async () => {
    const cache = new RuntimePlanCacheService(); const publisher = client(); const subscriber = client();
    publisher.publish.mockRejectedValueOnce(new Error("redis unavailable"));
    const service = new RuntimePlanCacheInvalidationService(cache, { publisher: publisher as any, subscriber: subscriber as any });
    cache.set("tenant-a:project:env", { release: "a" });
    await expect(service.invalidateTenant("tenant-a")).resolves.toBeUndefined();
    expect(cache.get("tenant-a:project:env")).toBeUndefined();
  });
});
