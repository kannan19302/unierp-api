import { describe, expect, it, vi } from "vitest";
vi.mock("@kannan19302/database", () => ({ prisma: {} }));
import { DeveloperAuthorizationService } from "./developer-authorization.service";

describe("DeveloperAuthorizationService", () => {
  it("keeps inherited RBAC when no project ABAC policy exists", async () => {
    const service = new DeveloperAuthorizationService(); (service as any).db = { builderPermissionRule: { findMany: vi.fn(async () => []) } };
    await expect(service.assertProjectAction("t", "p", { userId: "u", roles: [] }, "AUTHOR")).resolves.toBeUndefined();
  });
  it("denies a matching explicit deny even when a role allow also exists", async () => {
    const service = new DeveloperAuthorizationService(); (service as any).db = { builderPermissionRule: { findMany: vi.fn(async () => [{ role: "maker", access: "ALLOW" }, { userId: "u", access: "DENY" }]) } };
    await expect(service.assertProjectAction("t", "p", { userId: "u", roles: ["maker"] }, "RELEASE")).rejects.toThrow(/denies/);
  });
  it("requires an explicit matching allow after a project enables a policy", async () => {
    const service = new DeveloperAuthorizationService(); (service as any).db = { builderPermissionRule: { findMany: vi.fn(async () => [{ role: "approver", access: "ALLOW" }]) } };
    await expect(service.assertProjectAction("t", "p", { userId: "u", roles: ["maker"] }, "DEPLOY")).rejects.toThrow(/does not grant/);
  });
});
