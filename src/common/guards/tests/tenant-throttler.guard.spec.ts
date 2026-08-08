import { describe, it, expect, vi, beforeEach } from "vitest";
import { ExecutionContext } from "@nestjs/common";
import { TENANT_PLAN_LIMITS } from "../tenant-plan-limits";
import { TenantThrottlerGuard } from "../tenant-throttler.guard";
import { InMemoryThrottlerStorage } from "../tenant-throttler-storage";
import { ThrottlerStorage } from "@nestjs/throttler";

// verifyTypedToken is mocked so the token → tenantId path (the ordering fix:
// the throttler resolves identity itself because JwtAuthGuard runs AFTER this
// global guard) is deterministic without signing real tokens.
const authMock = vi.hoisted(() => ({
  verifyTypedToken: vi.fn((token: string) => {
    if (token === "session-token-a") {
      return { tenantId: "tenant-A", userId: "user-1" };
    }
    if (token === "apikey-token") {
      return { tenantId: "tenant-A", userId: "apikey:key-9" };
    }
    return null;
  }),
}));

vi.mock("@kannan19302/auth", () => ({
  verifyTypedToken: authMock.verifyTypedToken,
  TOKEN_TYPE: { SESSION: "session" },
}));

interface GuardCtorOpts {
  plan?: string;
  storage?: ThrottlerStorage;
  throttlers?: Array<{ name: string; ttl: number; limit: number }>;
}

function makeGuard(opts: GuardCtorOpts = {}): {
  guard: TenantThrottlerGuard;
  planService: { getPlan: ReturnType<typeof vi.fn> };
  res: { header: ReturnType<typeof vi.fn> };
} {
  const planService = { getPlan: vi.fn().mockResolvedValue(opts.plan ?? "free") };
  const storage = opts.storage ?? new InMemoryThrottlerStorage();
  const reflector = { getAllAndOverride: vi.fn().mockReturnValue(undefined) } as any;
  const res = { header: vi.fn() };
  const guard = new TenantThrottlerGuard(
    { throttlers: opts.throttlers ?? [] },
    storage,
    reflector,
    planService,
  ) as any;
  return { guard, planService, res };
}

function buildContext(req: Record<string, any>): ExecutionContext {
  const res = { header: vi.fn() };
  return {
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
}

describe("TENANT_PLAN_LIMITS", () => {
  it("free tier has lowest limits", () => {
    expect(TENANT_PLAN_LIMITS.free.short).toBeLessThan(
      TENANT_PLAN_LIMITS.starter.short,
    );
    expect(TENANT_PLAN_LIMITS.free.medium).toBeLessThan(
      TENANT_PLAN_LIMITS.starter.medium,
    );
  });

  it("enterprise tier has highest limits", () => {
    expect(TENANT_PLAN_LIMITS.enterprise.short).toBeGreaterThan(
      TENANT_PLAN_LIMITS.business.short,
    );
    expect(TENANT_PLAN_LIMITS.enterprise.medium).toBeGreaterThan(
      TENANT_PLAN_LIMITS.business.medium,
    );
  });

  it("every tier defines short, medium, report and concurrency buckets", () => {
    for (const limits of Object.values(TENANT_PLAN_LIMITS)) {
      expect(limits.short).toBeTypeOf("number");
      expect(limits.medium).toBeTypeOf("number");
      expect(limits.report).toBeTypeOf("number");
      expect(limits.concurrency).toBeTypeOf("number");
    }
  });

  it("report buckets scale with plan and are tighter than the medium budget", () => {
    expect(TENANT_PLAN_LIMITS.free.report).toBeLessThan(
      TENANT_PLAN_LIMITS.enterprise.report,
    );
    for (const limits of Object.values(TENANT_PLAN_LIMITS)) {
      expect(limits.report).toBeLessThanOrEqual(limits.medium);
    }
  });

  it("every plan allows at least one concurrent report query", () => {
    for (const limits of Object.values(TENANT_PLAN_LIMITS)) {
      expect(limits.concurrency).toBeGreaterThanOrEqual(1);
    }
  });
});

describe("TenantThrottlerGuard.getTracker", () => {
  beforeEach(() => {
    authMock.verifyTypedToken.mockClear();
  });

  it("uses tenant: prefix for a request whose user is already populated", async () => {
    const { guard } = makeGuard();
    const tracker = await guard.getTracker({
      user: { tenantId: "tenant-123" },
    });
    expect(tracker).toBe("tenant:tenant-123");
  });

  it("uses apikey: prefix for API key requests", async () => {
    const { guard } = makeGuard();
    const tracker = await guard.getTracker({
      user: { tenantId: "tenant-123", userId: "apikey:key-456" },
    });
    expect(tracker).toBe("apikey:tenant-123:apikey:key-456");
  });

  it("resolves tenantId from the Authorization bearer token when no guard ran first", async () => {
    // This is the ordering fix: JwtAuthGuard (per-controller) runs AFTER this
    // global APP_GUARD, so req.user is absent here in production.
    const { guard } = makeGuard();
    const tracker = await guard.getTracker({
      ip: "10.0.0.1",
      cookies: {},
      headers: { authorization: "Bearer session-token-a" },
    });
    expect(tracker).toBe("tenant:tenant-A");
  });

  it("resolves tenantId from the auth cookie when no Authorization header is present", async () => {
    const { guard } = makeGuard();
    const tracker = await guard.getTracker({
      ip: "10.0.0.1",
      cookies: { auth_token: "session-token-a" },
      headers: {},
    });
    expect(tracker).toBe("tenant:tenant-A");
  });

  it("keeps apikey identity when read from the token", async () => {
    const { guard } = makeGuard();
    const tracker = await guard.getTracker({
      ip: "10.0.0.1",
      cookies: {},
      headers: { authorization: "Bearer apikey-token" },
    });
    expect(tracker).toBe("apikey:tenant-A:apikey:key-9");
  });

  it("falls back to ip: for unauthenticated requests", async () => {
    const { guard } = makeGuard();
    const tracker = await guard.getTracker({
      ip: "192.168.1.1",
      cookies: {},
      headers: {},
    });
    expect(tracker).toBe("ip:192.168.1.1");
  });

  it("falls back to ip: when the token is invalid", async () => {
    const { guard } = makeGuard();
    const tracker = await guard.getTracker({
      ip: "192.168.1.1",
      cookies: { auth_token: "garbage-token" },
      headers: {},
    });
    expect(tracker).toBe("ip:192.168.1.1");
  });
});

describe("TenantThrottlerGuard.planLimitFor", () => {
  it("applies free tier limits on normal routes", async () => {
    const { guard } = makeGuard({ plan: "free" });
    const req = { user: { tenantId: "tenant-A" }, originalUrl: "/api/v1/products" };
    expect(await guard.planLimitFor(req, "short")).toBe(5);
    expect(await guard.planLimitFor(req, "medium")).toBe(30);
  });

  it("applies the plan's short bucket on reporting routes", async () => {
    const { guard } = makeGuard({ plan: "business" });
    const req = {
      user: { tenantId: "tenant-A" },
      originalUrl: "/api/v1/reporting/engine/query",
    };
    expect(await guard.planLimitFor(req, "short")).toBe(50);
  });

  it("tightens the reporting-engine medium bucket to the plan's report budget", async () => {
    const { guard } = makeGuard({ plan: "free" });
    const req = {
      user: { tenantId: "tenant-A" },
      originalUrl: "/api/v1/reporting/engine/query",
    };
    expect(await guard.planLimitFor(req, "medium")).toBe(10);
  });

  it("does not tighten non-reporting routes", async () => {
    const { guard } = makeGuard({ plan: "free" });
    const req = {
      user: { tenantId: "tenant-A" },
      originalUrl: "/api/v1/inventory/products",
    };
    expect(await guard.planLimitFor(req, "medium")).toBe(30);
  });

  it("scales with the tenant's plan", async () => {
    const { guard } = makeGuard({ plan: "enterprise" });
    const req = { user: { tenantId: "tenant-A" }, originalUrl: "/api/v1/products" };
    expect(await guard.planLimitFor(req, "short")).toBe(100);
    expect(await guard.planLimitFor(req, "medium")).toBe(1000);
  });

  it("applies free limits to unauthenticated requests", async () => {
    const { guard } = makeGuard({ plan: "free" });
    const req = { ip: "10.0.0.1", cookies: {}, headers: {}, originalUrl: "/api/v1/products" };
    expect(await guard.planLimitFor(req, "short")).toBe(5);
    expect(guard.planService.getPlan).not.toHaveBeenCalled();
  });

  it("degrades an unknown plan to the free tier", async () => {
    const { guard } = makeGuard({ plan: "ultra-secret-mega-plan" });
    const req = { user: { tenantId: "tenant-A" }, originalUrl: "/api/v1/products" };
    expect(await guard.planLimitFor(req, "short")).toBe(5);
  });
});

describe("TenantThrottlerGuard per-tenant isolation", () => {
  it("lets tenant B pass after tenant A exhausts its own budget", async () => {
    const { guard } = makeGuard({
      plan: "free",
      throttlers: [{ name: "short", ttl: 60000, limit: 100 }],
    });
    await guard.onModuleInit();

    const ctxA = () =>
      buildContext({ user: { tenantId: "tenant-A" }, ip: "10.0.0.1" });
    const ctxB = () =>
      buildContext({ user: { tenantId: "tenant-B" }, ip: "10.0.0.1" });

    // free plan short bucket = 5; the plan override governs the configured
    // module default of 100.
    for (let i = 0; i < 5; i++) {
      await expect(guard.canActivate(ctxA())).resolves.toBe(true);
    }
    // Tenant A's sixth request in the window is throttled...
    await expect(guard.canActivate(ctxA())).rejects.toThrow();

    // ...while tenant B, sharing the same IP, is untouched.
    await expect(guard.canActivate(ctxB())).resolves.toBe(true);
  });

  it("throttles unauthenticated traffic on a shared IP bucket", async () => {
    const { guard } = makeGuard({
      plan: "free",
      throttlers: [{ name: "short", ttl: 60000, limit: 100 }],
    });
    await guard.onModuleInit();

    const anon = () =>
      buildContext({ ip: "203.0.113.9", cookies: {}, headers: {} });

    for (let i = 0; i < 5; i++) {
      await expect(guard.canActivate(anon())).resolves.toBe(true);
    }
    await expect(guard.canActivate(anon())).rejects.toThrow();
  });
});

describe("InMemoryThrottlerStorage", () => {
  it("returns 1 hit on first increment", async () => {
    const storage = new InMemoryThrottlerStorage();
    const result = await storage.increment("test:key", 1000, 10, 1000, "short");
    expect(result.totalHits).toBe(1);
    expect(result.isBlocked).toBe(false);
  });

  it("blocks when limit exceeded", async () => {
    const storage = new InMemoryThrottlerStorage();
    await storage.increment("test:block", 1000, 2, 1000, "short");
    await storage.increment("test:block", 1000, 2, 1000, "short");
    const result = await storage.increment("test:block", 1000, 2, 1000, "short");
    expect(result.totalHits).toBe(3);
    expect(result.isBlocked).toBe(true);
  });

  it("expires after ttl and resets", async () => {
    const storage = new InMemoryThrottlerStorage();
    await storage.increment("test:expire", 100, 2, 1000, "short");
    await new Promise((r) => setTimeout(r, 110));

    const result = await storage.increment("test:expire", 100, 2, 1000, "short");
    expect(result.totalHits).toBe(1);
    expect(result.isBlocked).toBe(false);
  });

  it("keys are isolated", async () => {
    const storage = new InMemoryThrottlerStorage();
    await storage.increment("tenant-a", 1000, 2, 1000, "short");
    await storage.increment("tenant-a", 1000, 2, 1000, "short");

    const resultA = await storage.increment("tenant-a", 1000, 2, 1000, "short");
    expect(resultA.isBlocked).toBe(true);

    const resultB = await storage.increment("tenant-b", 1000, 2, 1000, "short");
    expect(resultB.totalHits).toBe(1);
    expect(resultB.isBlocked).toBe(false);
  });
});
