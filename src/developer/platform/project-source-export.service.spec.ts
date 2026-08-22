import { describe, expect, it, vi } from "vitest";
import { ProjectSourceExportService } from "./project-source-export.service";

describe("ProjectSourceExportService", () => {
  it("exports canonical artifact source with a stable independently verifiable bundle hash", async () => {
    const releases = { currentComposition: vi.fn(async () => ({ fingerprint: "fp", packages: [{ packageId: "pkg", version: "1.0.0" }], requiredBindings: [], artifacts: [{ artifactId: "form-1", artifactType: "FORM", revision: 2, sourceHash: "hash", source: { apiVersion: "unierp.dev/v1", kind: "FORM" } }] })) };
    const service = new ProjectSourceExportService(releases as any);
    const first = await service.export("tenant-1", "project-1"), second = await service.export("tenant-1", "project-1");
    expect(first.bundleHash).toBe(second.bundleHash);
    expect(first.artifacts[0]).toMatchObject({ id: "form-1", revision: 2, source: { kind: "FORM" } });
  });
});
