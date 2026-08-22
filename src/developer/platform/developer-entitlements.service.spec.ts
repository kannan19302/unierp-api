import { describe, expect, it, vi } from "vitest";
vi.mock("@kannan19302/database", () => ({ prisma: {} }));
import { DeveloperEntitlementsService } from "./developer-entitlements.service";

describe("DeveloperEntitlementsService", () => {
  it("persists validated tenant-specific governor limits", async () => {
    const upsert = vi.fn(async ({ create }: any) => create); const service = new DeveloperEntitlementsService();
    (service as any).db = { tenantDeveloperEntitlement: { upsert } };
    await expect(service.save("tenant-1", { artifacts: { soft: 4_000, hard: 20_000 } }, "admin-1")).resolves.toMatchObject({ tenantId: "tenant-1", limits: { artifacts: { soft: 4_000, hard: 20_000 } } });
  });
  it("accepts a bounded concurrent-preview entitlement", async () => {
    const upsert = vi.fn(async ({ create }: any) => create); const service = new DeveloperEntitlementsService();
    (service as any).db = { tenantDeveloperEntitlement: { upsert } };
    await expect(service.save("tenant-1", { previewSessions: { soft: 4, hard: 12 } })).resolves.toMatchObject({ limits: { previewSessions: { soft: 4, hard: 12 } } });
  });
  it("ignores malformed stored entitlement entries rather than weakening a default limit", async () => {
    const service = new DeveloperEntitlementsService();
    (service as any).db = { tenantDeveloperEntitlement: { findFirst: vi.fn(async () => ({ limits: { packages: { soft: 100, hard: 2 } } })) } };
    await expect(service.limits("tenant-1")).resolves.toEqual({});
  });
});
