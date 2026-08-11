/**
 * M33 exit criterion: "A grant scoped to one region provably cannot plan
 * against another — a two-scope test asserting ZERO resources visible,
 * not filtered results. No platform.* wildcard satisfies an estate
 * grant. Unauthorised returns 403."
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

let grants: any[];
let kinds: any[];
let resources: any[];
let desiredStates: any[];
let attributions: any[];
let seq = 0;
const nextId = (p: string) => `${p}-${++seq}`;

vi.mock("@kannan19302/database", () => ({
  prisma: {
    estateGrant: {
      create: vi.fn(({ data }: any) => {
        const row = { id: nextId("grant"), ...data };
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

import { EstateAbacService } from "./estate-abac.service";

describe("M33 · RBAC/ABAC for the estate — least privilege", () => {
  let abac: EstateAbacService;

  beforeEach(() => {
    vi.clearAllMocks();
    grants = [];
    kinds = [];
    resources = [];
    desiredStates = [];
    attributions = [];

    kinds.push({ id: "kind-1", name: "compute-instance" });
    resources.push(
      { id: "res-us", kindId: "kind-1", name: "us-instance" },
      { id: "res-eu", kindId: "kind-1", name: "eu-instance" },
    );
    desiredStates.push(
      { resourceId: "res-us", state: { region: "us-east-1" } },
      { resourceId: "res-eu", state: { region: "eu-west-1" } },
    );

    abac = new EstateAbacService();
  });

  it("a grant scoped to one region provably CANNOT plan against another — asserting ZERO resources visible, not filtered", async () => {
    await abac.grant("operator-1", "plan", { region: "us-east-1" });

    // The operator's own resource, in their granted region: authorized.
    expect(await abac.isAuthorized("operator-1", "res-us", "plan")).toBe(true);

    // A DIFFERENT region: not authorized at all.
    expect(await abac.isAuthorized("operator-1", "res-eu", "plan")).toBe(false);

    // The two-scope list check: candidates spanning BOTH regions returns
    // exactly the one in-region resource -- ZERO for the other region,
    // not both with one flagged.
    const authorized = await abac.listAuthorizedResourceIds("operator-1", "plan", ["res-us", "res-eu"]);
    expect(authorized).toEqual(["res-us"]);
    expect(authorized).not.toContain("res-eu");
  });

  it("a subject with NO grants at all is never authorized -- no implicit allow", async () => {
    expect(await abac.isAuthorized("operator-ungranted", "res-us", "plan")).toBe(false);
  });

  it("a grant for the wrong capability does not authorize a different one", async () => {
    await abac.grant("operator-1", "read", { region: "us-east-1" });
    expect(await abac.isAuthorized("operator-1", "res-us", "plan")).toBe(false);
    expect(await abac.isAuthorized("operator-1", "res-us", "read")).toBe(true);
  });

  it("multiple scope dimensions must ALL match -- a grant scoped to region AND environment refuses a resource matching only one", async () => {
    attributions.push({ resourceId: "res-us", environment: "staging" });
    await abac.grant("operator-1", "plan", { region: "us-east-1", environment: "prod" });

    // res-us is in the right region but the WRONG environment.
    expect(await abac.isAuthorized("operator-1", "res-us", "plan")).toBe(false);
  });

  it("an unscoped-on-one-dimension grant (region only) does not care about environment/tenant/kind", async () => {
    attributions.push({ resourceId: "res-us", environment: "prod", tenantId: "tenant-x" });
    await abac.grant("operator-1", "plan", { region: "us-east-1" });
    expect(await abac.isAuthorized("operator-1", "res-us", "plan")).toBe(true);
  });
});
