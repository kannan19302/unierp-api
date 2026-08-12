/**
 * G03 exit criterion: "Uninstall leaves no residue and no dangling
 * permissions."
 *
 * ExtensionSchemaService's own docstring already promised "reclaiming
 * storage is a separate, deliberate operation" — but no such operation
 * existed anywhere in this codebase. purgeExtensionData() is that
 * operation: deliberately separate from uninstall(), gated so it can
 * only run against an installation that IS already uninstalled — an
 * accidental double-uninstall-click can never cascade into
 * unrecoverable data loss on a LIVE installation.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

let installations: any[];

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
  },
}));

import { ExtensionRegistryService } from "../extension-registry.service";

describe("ExtensionRegistryService.purgeExtensionData", () => {
  let service: ExtensionRegistryService;
  const schemaService = { dropTables: vi.fn().mockResolvedValue(["ext_widget_note"]) };

  beforeEach(() => {
    vi.clearAllMocks();
    schemaService.dropTables.mockResolvedValue(["ext_widget_note"]);
    installations = [];
    service = new ExtensionRegistryService(schemaService as any, {} as any);
  });

  it("G03: refuses to purge a LIVE (not-yet-uninstalled) installation's data", async () => {
    installations = [
      { tenantId: "t1", extensionId: "widget", status: "ENABLED" },
    ];
    await expect(
      service.purgeExtensionData("t1", "widget"),
    ).rejects.toThrow(/must be uninstalled/i);
    expect(schemaService.dropTables).not.toHaveBeenCalled();
  });

  it("G03: purges an UNINSTALLED extension's tables — this is the real 'no residue' mechanism", async () => {
    installations = [
      { tenantId: "t1", extensionId: "widget", status: "UNINSTALLED" },
    ];
    const result = await service.purgeExtensionData("t1", "widget");
    expect(schemaService.dropTables).toHaveBeenCalledWith("widget");
    expect(result.droppedTables).toEqual(["ext_widget_note"]);
  });

  it("G03: 404s for an extension with no installation record at all for this tenant", async () => {
    installations = [];
    await expect(
      service.purgeExtensionData("t1", "never-installed"),
    ).rejects.toThrow(/no installation record/i);
  });
});
