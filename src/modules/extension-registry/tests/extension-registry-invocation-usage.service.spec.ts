/**
 * G04 exit criterion: "An author debugs a failing handler from the
 * portal without our involvement. A tenant sees what an installed
 * extension is doing."
 *
 * ExtensionInvocationUsage rows were written on every invocation
 * (recordUsage) but never read back anywhere — no GET endpoint exposed
 * them to anyone. The data existed, fully wired for collection, but was
 * completely unreachable.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

let installations: any[];
let usageRows: any[];

vi.mock("@kannan19302/database", () => ({
  prisma: {
    tenantExtensionInstallation: {
      findUnique: vi.fn(({ where }: any) =>
        installations.find(
          (i) =>
            i.tenantId === where.tenantId_extensionId.tenantId &&
            i.extensionId === where.tenantId_extensionId.extensionId,
        ) ?? null,
      ),
    },
    extensionInvocationUsage: {
      findMany: vi.fn(({ where, take }: any) =>
        usageRows
          .filter(
            (r) => r.tenantId === where.tenantId && r.extensionId === where.extensionId,
          )
          .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime())
          .slice(0, take),
      ),
    },
  },
}));

import { ExtensionRegistryService } from "../extension-registry.service";

describe("ExtensionRegistryService.getInvocationUsage", () => {
  let service: ExtensionRegistryService;

  beforeEach(() => {
    installations = [
      { tenantId: "t1", extensionId: "ext-1", status: "ENABLED" },
    ];
    usageRows = [
      {
        id: "u1",
        tenantId: "t1",
        extensionId: "ext-1",
        hook: "onOrderCreated",
        failed: true,
        errorKind: "TIMEOUT",
        occurredAt: new Date("2026-01-01T00:00:00Z"),
      },
      {
        id: "u2",
        tenantId: "t1",
        extensionId: "ext-1",
        hook: "onOrderCreated",
        failed: false,
        errorKind: null,
        occurredAt: new Date("2026-01-02T00:00:00Z"),
      },
    ];
    service = new ExtensionRegistryService({} as any, {} as any);
  });

  it("G04: returns the real, tenant-scoped invocation usage — a tenant/author can now see what an installed extension is doing", async () => {
    const result = await service.getInvocationUsage("t1", "ext-1");
    expect(result).toHaveLength(2);
    // newest first
    expect(result[0].id).toBe("u2");
    expect(result[1].errorKind).toBe("TIMEOUT");
  });

  it("G04: refuses to leak usage for an extension not installed for this tenant", async () => {
    await expect(
      service.getInvocationUsage("t1", "ext-not-installed"),
    ).rejects.toThrow(/not installed/i);
  });

  it("G04: a different tenant cannot see another tenant's extension usage", async () => {
    await expect(service.getInvocationUsage("t2", "ext-1")).rejects.toThrow(
      /not installed/i,
    );
  });
});
