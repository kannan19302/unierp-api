import { describe, expect, it, vi } from "vitest";
vi.mock("@kannan19302/database", () => ({ prisma: {} }));
import { ProjectChangeSetsService } from "./project-change-sets.service";

describe("ProjectChangeSetsService", () => {
  it("creates a changeset pinned to the verified import plan hash and base", async () => {
    const imports = { plan: vi.fn(async () => ({ bundleHash: "bundle-hash", baseFingerprint: "base-fp" })) };
    const create = vi.fn(async ({ data }: any) => data);
    const service = new ProjectChangeSetsService(imports as any, {} as any); (service as any).db = { projectChangeSet: { create } };
    await expect(service.create({ tenantId: "tenant-1", projectId: "project-1", branch: "feature/forms", title: "Forms", bundle: {} })).resolves.toMatchObject({ bundleHash: "bundle-hash", baseFingerprint: "base-fp" });
  });

  it("prevents authors from approving their own changesets", async () => {
    const service = new ProjectChangeSetsService({} as any, {} as any);
    (service as any).db = { projectChangeSet: { findFirst: vi.fn(async () => ({ id: "cs-1", createdBy: "user-1" })) } };
    await expect(service.review({ tenantId: "tenant-1", projectId: "project-1", id: "cs-1", reviewerId: "user-1", decision: "APPROVED" })).rejects.toThrow(/cannot approve/);
  });

  it("allows only the draft author to submit it for review", async () => {
    const service = new ProjectChangeSetsService({} as any, {} as any);
    (service as any).db = { projectChangeSet: { findFirst: vi.fn(async () => ({ id: "cs-1", createdBy: "author-1" })) } };
    await expect(service.submit("tenant-1", "project-1", "cs-1", "other-user")).rejects.toThrow(/Only the changeset author/);
  });

  it("merges only an approved changeset whose original base is still current", async () => {
    const imports = { apply: vi.fn(async () => ({ applied: true })) };
    const releases = { currentComposition: vi.fn(async () => ({ fingerprint: "base-fp" })) };
    const update = vi.fn(async () => ({})); const updateMany = vi.fn(async () => ({ count: 1 }));
    const service = new ProjectChangeSetsService(imports as any, releases as any);
    (service as any).db = { projectChangeSet: { findFirst: vi.fn(async () => ({ id: "cs-1", baseFingerprint: "base-fp", bundle: {} })), update, updateMany } };
    await expect(service.merge({ tenantId: "tenant-1", projectId: "project-1", id: "cs-1", mergedBy: "reviewer-1" })).resolves.toEqual({ applied: true });
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "MERGED", mergedBy: "reviewer-1" }) }));
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "cs-1", status: "APPROVED" }, data: { status: "MERGING" } }));
  });

  it("rejects merge when the project changed after review", async () => {
    const service = new ProjectChangeSetsService({} as any, { currentComposition: vi.fn(async () => ({ fingerprint: "new-fp" })) } as any);
    (service as any).db = { projectChangeSet: { findFirst: vi.fn(async () => ({ id: "cs-1", baseFingerprint: "old-fp", bundle: {} })) } };
    await expect(service.merge({ tenantId: "tenant-1", projectId: "project-1", id: "cs-1", mergedBy: "reviewer-1" })).rejects.toThrow(/stale/);
  });

  it("restores approval when applying a claimed merge fails", async () => {
    const imports = { apply: vi.fn(async () => { throw new Error("import failed"); }) };
    const service = new ProjectChangeSetsService(imports as any, { currentComposition: vi.fn(async () => ({ fingerprint: "base-fp" })) } as any);
    const updateMany = vi.fn(async () => ({ count: 1 }));
    (service as any).db = { projectChangeSet: { findFirst: vi.fn(async () => ({ id: "cs-1", baseFingerprint: "base-fp", bundle: {} })), updateMany } };
    await expect(service.merge({ tenantId: "tenant-1", projectId: "project-1", id: "cs-1", mergedBy: "reviewer-1" })).rejects.toThrow("import failed");
    expect(updateMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: { id: "cs-1", status: "MERGING" }, data: { status: "APPROVED" } }));
  });
});
