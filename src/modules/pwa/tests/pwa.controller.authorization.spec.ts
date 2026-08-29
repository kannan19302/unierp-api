import "reflect-metadata";
import { GUARDS_METADATA } from "@nestjs/common/constants";
import { describe, expect, it, vi } from "vitest";

vi.mock("../pwa.service", () => ({ PwaService: class PwaService {} }));
vi.mock("../../../common/guards/jwt-auth.guard", () => ({
  JwtAuthGuard: class JwtAuthGuard {},
}));
vi.mock("../../../common/guards/rbac.guard", () => ({
  RbacGuard: class RbacGuard {},
}));

import { PERMISSIONS_KEY } from "../../../common/decorators/permissions.decorator";
import { JwtAuthGuard } from "../../../common/guards/jwt-auth.guard";
import { RbacGuard } from "../../../common/guards/rbac.guard";
import { PwaController } from "../pwa.controller";

describe("PwaController tenant configuration boundaries", () => {
  it.each([
    ["getManifestJson", "pwa.manifest-json.read"],
    ["getServiceWorkerScript", "pwa.service-worker-script.read"],
    ["getCacheRulesJson", "pwa.cache-rule-json.read"],
  ] as const)("%s requires verified tenant-staff authority", (methodName, permission) => {
    const handler = PwaController.prototype[methodName];
    const guards = Reflect.getMetadata(GUARDS_METADATA, handler) as unknown[];

    expect(guards).toContain(JwtAuthGuard);
    expect(guards).toContain(RbacGuard);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, handler)).toEqual([permission]);
  });

  it("passes the verified tenant rather than a client-selected header", async () => {
    const pwaService = { getManifestJson: vi.fn().mockResolvedValue({ name: "Tenant A" }) } as any;
    const controller = new PwaController(pwaService);
    const response = { setHeader: vi.fn(), json: vi.fn() } as any;

    await controller.getManifestJson(
      { user: { tenantId: "tenant-a" }, headers: { "x-tenant-id": "tenant-b" } } as any,
      response,
    );

    expect(pwaService.getManifestJson).toHaveBeenCalledWith("tenant-a");
    expect(response.json).toHaveBeenCalledWith({ name: "Tenant A" });
  });
});
