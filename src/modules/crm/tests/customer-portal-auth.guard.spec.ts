import { UnauthorizedException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";

const verifyToken = vi.hoisted(() => vi.fn());

vi.mock("@kannan19302/auth", () => ({ verifyToken }));

import { CustomerPortalAuthGuard } from "../customer-portal-auth.guard";

function contextFor(request: Record<string, unknown>) {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as any;
}

describe("CustomerPortalAuthGuard", () => {
  beforeEach(() => vi.resetAllMocks());

  it("denies a request with no portal session before any record access", () => {
    expect(() => new CustomerPortalAuthGuard().canActivate(contextFor({ headers: {} }))).toThrow(UnauthorizedException);
    expect(verifyToken).not.toHaveBeenCalled();
  });

  it("denies a signed non-portal or unscoped token", () => {
    verifyToken.mockReturnValue({ portal: false, tenantId: "tenant-a", customerId: "customer-a" });

    expect(() => new CustomerPortalAuthGuard().canActivate(contextFor({ headers: { authorization: "Bearer token" } }))).toThrow("Invalid or expired portal session");
  });

  it("accepts only a portal-scoped token and attaches its tenant/customer scope", () => {
    verifyToken.mockReturnValue({ portal: true, tenantId: "tenant-a", userId: "user-a", customerId: "customer-a" });
    const request: Record<string, any> = { cookies: { portal_auth_token: "token" }, headers: {} };

    expect(new CustomerPortalAuthGuard().canActivate(contextFor(request))).toBe(true);
    expect(request.user).toMatchObject({ portal: true, tenantId: "tenant-a", customerId: "customer-a" });
  });
});
