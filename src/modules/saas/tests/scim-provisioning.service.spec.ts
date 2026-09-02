/**
 * D22 exit criterion (SCIM half): "... provisions users via SCIM ..."
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

let users: any[];
let seq = 0;

vi.mock("@/common/idp-client", () => ({
  idpClient: {
    user: {
      findFirst: vi.fn(({ where }: any) => users.find((u) => u.tenantId === where.tenantId && u.email === where.email) ?? null),
      create: vi.fn(({ data }: any) => { const row = { id: `u-${++seq}`, ...data }; users.push(row); return row; }),
      update: vi.fn(({ where: { id }, data }: any) => { const row = users.find((u) => u.id === id)!; Object.assign(row, data); return row; }),
      findMany: vi.fn(({ where }: any) => users.filter((u) => u.tenantId === where.tenantId)),
    },
  },
}));

import { ScimProvisioningService } from "../services/scim-provisioning.service";

describe("D22 · SCIM user provisioning", () => {
  let scim: ScimProvisioningService;

  beforeEach(() => {
    vi.clearAllMocks();
    users = [];
    seq = 0;
    scim = new ScimProvisioningService();
  });

  const resource = { userName: "jane@example.com", emails: [{ value: "jane@example.com", primary: true }], active: true, name: { givenName: "Jane", familyName: "Doe" } };

  it("PROVISIONS a new user from a SCIM User resource", async () => {
    const result = await scim.provisionUser("t1", resource);
    expect(result.created).toBe(true);
    expect(users).toHaveLength(1);
    expect(users[0].email).toBe("jane@example.com");
    expect(users[0].status).toBe("ACTIVE");
  });

  it("is IDEMPOTENT: provisioning the SAME userName twice UPDATES, never duplicates", async () => {
    await scim.provisionUser("t1", resource);
    const second = await scim.provisionUser("t1", { ...resource, name: { givenName: "Janet", familyName: "Doe" } });

    expect(second.created).toBe(false);
    expect(users).toHaveLength(1); // still exactly one user
    expect(users[0].firstName).toBe("Janet"); // the update actually applied
  });

  it("DEPROVISIONS a user by SUSPENDING, never hard-deleting", async () => {
    await scim.provisionUser("t1", resource);
    const result = await scim.deprovisionUser("t1", "jane@example.com");

    expect(result.active).toBe(false);
    expect(users).toHaveLength(1); // the record survives
    expect(users[0].status).toBe("SUSPENDED");
  });

  it("REFUSES deprovisioning a userName that was never provisioned", async () => {
    await expect(scim.deprovisionUser("t1", "nobody@example.com")).rejects.toThrow(/No SCIM-provisioned user/);
  });

  it("REFUSES a SCIM resource with no email at all", async () => {
    await expect(scim.provisionUser("t1", { userName: "x", emails: [], active: true })).rejects.toThrow(/at least one email/);
  });

  it("provisioning is tenant-scoped — the SAME userName in two tenants creates TWO independent users", async () => {
    await scim.provisionUser("t1", resource);
    await scim.provisionUser("t2", resource);
    expect(users).toHaveLength(2);
    expect(new Set(users.map((u) => u.tenantId))).toEqual(new Set(["t1", "t2"]));
  });
});
