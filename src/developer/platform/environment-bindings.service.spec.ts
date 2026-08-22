import { describe, expect, it, vi } from "vitest";

vi.mock("@kannan19302/database", () => ({ prisma: {} }));

import { EnvironmentBindingsService } from "./environment-bindings.service";

describe("EnvironmentBindingsService", () => {
  it("accepts non-secret vault locators and resets verification after a change", async () => {
    const upsert = vi.fn(async ({ create }: any) => ({ id: "binding-1", ...create }));
    const service = new EnvironmentBindingsService();
    (service as any).db = {
      devProject: { findFirst: vi.fn(async () => ({ id: "project-1" })) },
      environment: { findFirst: vi.fn(async () => ({ id: "environment-1" })) },
      environmentBinding: { upsert },
    };
    const result = await service.upsert({ tenantId: "tenant-1", projectId: "project-1", environmentId: "environment-1", key: "crm", kind: "CONNECTOR", reference: "connector://salesforce/production", requiredCapabilities: ["binding:crm"] });
    expect(result.status).toBe("UNVERIFIED");
    expect(upsert.mock.calls[0][0].update).toMatchObject({ status: "UNVERIFIED", verifiedAt: null });
  });

  it("rejects literal secret material rather than persisting it", async () => {
    const service = new EnvironmentBindingsService();
    (service as any).db = {};
    await expect(service.upsert({ tenantId: "tenant-1", projectId: "project-1", environmentId: "environment-1", key: "token", kind: "SECRET", reference: "sk_live_actual_secret" })).rejects.toThrow(/vault:\/\//);
  });

  it("only verifies an existing binding with a valid non-secret locator", async () => {
    const update = vi.fn(async ({ data }: any) => ({ status: data.status }));
    const service = new EnvironmentBindingsService();
    (service as any).db = { environmentBinding: { findFirst: vi.fn(async () => ({ id: "binding-1", reference: "vault://tenant/prod/crm" })), update } };
    await expect(service.verify({ tenantId: "tenant-1", projectId: "project-1", environmentId: "environment-1", key: "crm" })).resolves.toMatchObject({ status: "VERIFIED" });
    expect(update).toHaveBeenCalledOnce();
  });
});
