import { describe, it, expect, vi } from "vitest";
import { of, throwError, lastValueFrom } from "rxjs";
import { ThrottlerException } from "@nestjs/throttler";
import { TenantQueryBudgetInterceptor } from "../tenant-query-budget.interceptor";

function buildContext(tenantId?: string): any {
  return {
    switchToHttp: () => ({
      getRequest: () =>
        tenantId ? { user: { tenantId } } : { user: undefined },
    }),
  };
}

function callHandler(result: unknown): any {
  return { handle: () => of(result) };
}

describe("TenantQueryBudgetInterceptor", () => {
  it("passes through when there is no authenticated tenant", async () => {
    const planService = { getQueryBudget: vi.fn() };
    const interceptor = new TenantQueryBudgetInterceptor(planService);

    const result = await interceptor.intercept(
      buildContext(undefined),
      callHandler("ok"),
    );
    expect(await lastValueFrom(result)).toBe("ok");
    expect(planService.getQueryBudget).not.toHaveBeenCalled();
  });

  it("allows a tenant under its budget and releases the slot after completion", async () => {
    const planService = { getQueryBudget: vi.fn().mockResolvedValue(1) };
    const interceptor = new TenantQueryBudgetInterceptor(planService);

    const first = await interceptor.intercept(
      buildContext("tenant-A"),
      callHandler("r1"),
    );
    expect(await lastValueFrom(first)).toBe("r1");
    // Slot released after the first query completed, so the next is allowed.
    const second = await interceptor.intercept(
      buildContext("tenant-A"),
      callHandler("r2"),
    );
    expect(await lastValueFrom(second)).toBe("r2");
  });

  it("rejects a tenant already at its budget with a 429", async () => {
    const planService = { getQueryBudget: vi.fn().mockResolvedValue(1) };
    const interceptor = new TenantQueryBudgetInterceptor(planService);
    (interceptor as any).inFlight.set("tenant-A", 1);

    await expect(
      interceptor.intercept(buildContext("tenant-A"), callHandler("x")),
    ).rejects.toThrow(ThrottlerException);
  });

  it("releases the slot when the handler throws", async () => {
    const planService = { getQueryBudget: vi.fn().mockResolvedValue(1) };
    const interceptor = new TenantQueryBudgetInterceptor(planService);

    const obs = await interceptor.intercept(buildContext("tenant-A"), {
      handle: () => throwError(() => new Error("boom")),
    });
    await expect(lastValueFrom(obs)).rejects.toThrow("boom");
    expect((interceptor as any).inFlight.has("tenant-A")).toBe(false);
  });

  it("tracks concurrent tenants independently", async () => {
    const planService = { getQueryBudget: vi.fn().mockResolvedValue(1) };
    const interceptor = new TenantQueryBudgetInterceptor(planService);

    (interceptor as any).inFlight.set("tenant-A", 1);
    // Tenant B is on its own budget and unaffected by A's occupied slot.
    const obs = await interceptor.intercept(
      buildContext("tenant-B"),
      callHandler("ok"),
    );
    expect(await lastValueFrom(obs)).toBe("ok");
  });
});
