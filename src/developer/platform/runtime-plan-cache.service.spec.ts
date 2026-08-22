import { describe, expect, it, vi } from "vitest";
import { RuntimePlanCacheService } from "./runtime-plan-cache.service";

describe("RuntimePlanCacheService", () => {
  it("isolates invalidation to one tenant", () => {
    const cache = new RuntimePlanCacheService();
    cache.set("tenant-a:project-1:env-1", { id: "a" });
    cache.set("tenant-b:project-1:env-1", { id: "b" });

    cache.invalidateTenant("tenant-a");

    expect(cache.get("tenant-a:project-1:env-1")).toBeUndefined();
    expect(cache.get("tenant-b:project-1:env-1")).toEqual({ id: "b" });
  });

  it("expires entries instead of treating stale plans as a fallback", () => {
    vi.useFakeTimers();
    const cache = new RuntimePlanCacheService();
    cache.set("tenant-a:project-1:env-1", { id: "a" }, 1_000);
    vi.advanceTimersByTime(1_001);

    expect(cache.get("tenant-a:project-1:env-1")).toBeUndefined();
    vi.useRealTimers();
  });
});
