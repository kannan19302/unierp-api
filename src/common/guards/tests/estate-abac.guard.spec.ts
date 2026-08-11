/**
 * M33 exit criterion (guard half): "Unauthorised returns 403." and "No
 * platform.* wildcard satisfies an estate grant."
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ForbiddenException } from "@nestjs/common";

let grants: any[];
let kinds: any[];
let resources: any[];
let desiredStates: any[];
let attributions: any[];

vi.mock("@kannan19302/database", () => ({
  prisma: {
    estateGrant: {
      create: vi.fn(({ data }: any) => {
        const row = { id: `g-${grants.length + 1}`, ...data };
        grants.push(row);
        return row;
      }),
      findMany: vi.fn(({ where }: any) => grants.filter((g) => g.subjectId === where.subjectId && g.capability === where.capability)),
    },
    resource: {
      findUnique: vi.fn(({ where: { id } }: any) => {
        const row = resources.find((r) => r.id === id);
        if (!row) return null;
        return { ...row, kind: kinds.find((k) => k.id === row.kindId) };
      }),
    },
    desiredState: {
      findUnique: vi.fn(({ where: { resourceId } }: any) => desiredStates.find((d) => d.resourceId === resourceId) ?? null),
    },
    resourceAttribution: {
      findUnique: vi.fn(({ where: { resourceId } }: any) => attributions.find((a) => a.resourceId === resourceId) ?? null),
    },
  },
}));

import { EstateAbacService } from "../../../platform/v1/estate-abac.service";
import { EstateAbacGuard } from "../estate-abac.guard";

function makeContext(requirement: any, user: any, params: Record<string, string>) {
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => ({ user, params }) }),
  } as any;
}

function makeGuard(abac: EstateAbacService, requirement: any): EstateAbacGuard {
  const reflector = { getAllAndOverride: () => requirement };
  return new EstateAbacGuard(reflector as any, abac);
}

describe("M33 · EstateAbacGuard", () => {
  let abac: EstateAbacService;

  beforeEach(() => {
    vi.clearAllMocks();
    grants = [];
    kinds = [{ id: "kind-1", name: "compute-instance" }];
    resources = [
      { id: "res-us", kindId: "kind-1", name: "us" },
      { id: "res-eu", kindId: "kind-1", name: "eu" },
    ];
    desiredStates = [
      { resourceId: "res-us", state: { region: "us-east-1" } },
      { resourceId: "res-eu", state: { region: "eu-west-1" } },
    ];
    attributions = [];
    abac = new EstateAbacService();
  });

  it("unauthorised returns 403 (ForbiddenException): a subject with no grant at all is refused", async () => {
    const guard = makeGuard(abac, { capability: "plan" });
    const context = makeContext({ capability: "plan" }, { userId: "op-1" }, { id: "res-us" });
    await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
  });

  it("a region-scoped grant authorizes IN-region and refuses OUT-of-region with 403, on the exact same route", async () => {
    await abac.grant("op-1", "plan", { region: "us-east-1" });
    const guard = makeGuard(abac, { capability: "plan" });

    expect(await guard.canActivate(makeContext(null, { userId: "op-1" }, { id: "res-us" }))).toBe(true);
    await expect(guard.canActivate(makeContext(null, { userId: "op-1" }, { id: "res-eu" }))).rejects.toThrow(ForbiddenException);
  });

  it("NO platform.* (or any other) RBAC wildcard satisfies this guard -- the guard never reads req.user.permissions at all", async () => {
    const guard = makeGuard(abac, { capability: "plan" });
    // A user object carrying a super-admin-shaped RBAC wildcard, but NO
    // EstateGrant row exists for them at all.
    const superAdminUser = { userId: "op-super", permissions: ["platform.*"], roles: ["SUPER_ADMIN"] };
    await expect(guard.canActivate(makeContext(null, superAdminUser, { id: "res-us" }))).rejects.toThrow(ForbiddenException);
  });

  it("a route with no @RequireEstateGrant() metadata is unaffected", async () => {
    const guard = makeGuard(abac, null);
    const context = makeContext(null, { userId: "op-1" }, { id: "res-us" });
    expect(await guard.canActivate(context)).toBe(true);
  });
});
