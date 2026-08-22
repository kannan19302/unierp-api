import { describe, expect, it, vi } from "vitest";

vi.mock("@kannan19302/database", () => ({ prisma: {} }));

import {
  ArtifactRevisionsService,
  artifactContentHash,
  canonicalArtifactJson,
} from "./artifact-revisions.service";

const source = {
  apiVersion: "unierp.dev/v1" as const,
  kind: "FORM" as const,
  metadata: { id: "artifact-1", namespace: "com.acme.sales", name: "Lead" },
  spec: { title: "Lead", pages: [] },
  interfaces: { inputs: [], outputs: [], events: [] },
  dependencies: [],
  capabilities: [],
  tests: [],
  extensions: {},
};

describe("ArtifactRevisionsService", () => {
  it("hashes canonical content independent of object key order", () => {
    const reordered = {
      extensions: {}, tests: [], capabilities: [], dependencies: [],
      interfaces: { events: [], outputs: [], inputs: [] },
      spec: { pages: [], title: "Lead" },
      metadata: { name: "Lead", namespace: "com.acme.sales", id: "artifact-1" },
      kind: "FORM" as const, apiVersion: "unierp.dev/v1" as const,
    };
    expect(canonicalArtifactJson(source)).toBe(canonicalArtifactJson(reordered));
    expect(artifactContentHash(source)).toBe(artifactContentHash(reordered));
  });

  it("creates a content-addressed revision when syncing a legacy projection", async () => {
    const created = { id: "revision-1", revision: 1 };
    const service = new ArtifactRevisionsService();
    (service as any).db = { $transaction: (callback: any) => callback({ artifactRevision: { findFirst: vi.fn(async () => null), create: vi.fn(async () => created) } }) };
    vi.spyOn(service as any, "assertArtifactInScope").mockResolvedValue({ id: "artifact-1", artifactType: "PAGE" });
    await expect(service.syncLegacyProjection({ tenantId: "tenant-1", artifactId: "artifact-1", scope: { kind: "PROJECT", projectId: "project-1" }, source: { apiVersion: "unierp.dev/v1", kind: "PAGE", metadata: { id: "artifact-1", namespace: "tenant.tenant-1", name: "Home" }, spec: { title: "Home", slug: "/", sections: [] }, interfaces: { inputs: [], outputs: [], events: [] }, dependencies: [], capabilities: [], tests: [], extensions: {} } })).resolves.toBe(created);
  });

  it("does not duplicate an unchanged legacy projection revision", async () => {
    const pageSource = { apiVersion: "unierp.dev/v1" as const, kind: "PAGE" as const, metadata: { id: "artifact-1", namespace: "tenant.tenant-1", name: "Home" }, spec: { title: "Home", slug: "/", sections: [] }, interfaces: { inputs: [], outputs: [], events: [] }, dependencies: [], capabilities: [], tests: [], extensions: {} };
    const existing = { id: "revision-1", revision: 1, contentHash: artifactContentHash(pageSource) };
    const create = vi.fn();
    const service = new ArtifactRevisionsService();
    (service as any).db = { $transaction: (callback: any) => callback({ artifactRevision: { findFirst: vi.fn(async () => existing), create } }) };
    vi.spyOn(service as any, "assertArtifactInScope").mockResolvedValue({ id: "artifact-1", artifactType: "PAGE" });
    await expect(service.syncLegacyProjection({ tenantId: "tenant-1", artifactId: "artifact-1", scope: { kind: "PROJECT", projectId: "project-1" }, source: pageSource })).resolves.toBe(existing);
    expect(create).not.toHaveBeenCalled();
  });

  it("retries a competing legacy projection revision and converges on the winner", async () => {
    const pageSource = { apiVersion: "unierp.dev/v1" as const, kind: "PAGE" as const, metadata: { id: "artifact-1", namespace: "tenant.tenant-1", name: "Home" }, spec: { title: "Home", slug: "/", sections: [] }, interfaces: { inputs: [], outputs: [], events: [] }, dependencies: [], capabilities: [], tests: [], extensions: {} };
    const duplicate: any = new Error("duplicate"); duplicate.code = "P2002"; duplicate.name = "PrismaClientKnownRequestError";
    const transaction = vi.fn().mockRejectedValueOnce(duplicate).mockImplementationOnce((callback: any) => callback({ artifactRevision: { findFirst: vi.fn(async () => ({ id: "winner", revision: 1, contentHash: artifactContentHash(pageSource) })), create: vi.fn() } }));
    const service = new ArtifactRevisionsService();
    (service as any).db = { $transaction: transaction };
    vi.spyOn(service as any, "assertArtifactInScope").mockResolvedValue({ id: "artifact-1", artifactType: "PAGE" });
    await expect(service.syncLegacyProjection({ tenantId: "tenant-1", artifactId: "artifact-1", scope: { kind: "PROJECT", projectId: "project-1" }, source: pageSource })).resolves.toMatchObject({ id: "winner" });
    expect(transaction).toHaveBeenCalledTimes(2);
  });

  it("creates revision one with extracted dependencies and immutable parent semantics", async () => {
    const create = vi.fn(async ({ data }: any) => ({ id: "rev-1", ...data }));
    const db = {
      builderArtifact: { findFirst: vi.fn(async () => ({ id: "artifact-1", artifactType: "FORM", ownerProjectId: null })) },
      $transaction: (callback: any) => callback({
        artifactRevision: { findFirst: vi.fn(async () => null), create },
      }),
    };
    const service = new ArtifactRevisionsService();
    (service as any).db = db;
    const result = await service.create({
      tenantId: "tenant-1", artifactId: "artifact-1", scope: { kind: "LIBRARY" },
      expectedRevision: 0, source, createdBy: "user-1",
    });
    expect(result.revision).toBe(1);
    expect(result.parentRevisionId).toBeNull();
    expect(result.validationStatus).toBe("VALID");
    expect(create).toHaveBeenCalledOnce();
  });

  it("rejects a stale expected revision", async () => {
    const db = {
      builderArtifact: { findFirst: vi.fn(async () => ({ id: "artifact-1", artifactType: "FORM", ownerProjectId: null })) },
      $transaction: (callback: any) => callback({
        artifactRevision: { findFirst: vi.fn(async () => ({ id: "rev-2", revision: 2, contentHash: "different" })) },
      }),
    };
    const service = new ArtifactRevisionsService();
    (service as any).db = db;
    await expect(service.create({
      tenantId: "tenant-1", artifactId: "artifact-1", scope: { kind: "LIBRARY" },
      expectedRevision: 1, source,
    })).rejects.toMatchObject({ status: 409 });
  });

  it("creates imported project identities, ownership attachments and first revisions atomically", async () => {
    const createArtifact = vi.fn(async ({ data }: any) => ({ id: data.id }));
    const createAttachment = vi.fn(async () => ({}));
    const createRevision = vi.fn(async ({ data }: any) => ({ revision: data.revision, artifactId: data.artifactId }));
    const service = new ArtifactRevisionsService();
    (service as any).db = { $transaction: (callback: any) => callback({
      devProject: { findFirst: vi.fn(async () => ({ id: "project-1" })) },
      builderArtifact: { findFirst: vi.fn(async () => null), create: createArtifact },
      builderArtifactAttachment: { create: createAttachment },
      artifactRevision: { create: createRevision },
    }) };
    const imported = { ...source, metadata: { ...source.metadata, id: "form-new", name: "New Form" } };
    await expect(service.createImportedProjectArtifacts({ tenantId: "tenant-1", projectId: "project-1", createdBy: "user-1", artifacts: [{ id: "form-new", kind: "FORM", source: imported }] })).resolves.toHaveLength(1);
    expect(createArtifact).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ id: "form-new", ownerProjectId: "project-1" }) }));
    expect(createAttachment).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ isOwner: true }) }));
    expect(createRevision).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ revision: 1, artifactId: "form-new" }) }));
  });

  it("refuses imported-source deletion when a live artifact depends on it", async () => {
    const service = new ArtifactRevisionsService();
    (service as any).db = { $transaction: (callback: any) => callback({
      builderArtifact: { findMany: vi.fn(async () => [{ id: "form-1" }]) },
      artifactDependency: { findMany: vi.fn(async () => [{ alias: "shared", targetArtifactId: "form-1", sourceRevision: { artifactId: "page-1", artifact: { deletedAt: null } } }]) },
    }) };
    await expect(service.softDeleteImportedProjectArtifacts({ tenantId: "tenant-1", projectId: "project-1", artifactIds: ["form-1"] })).rejects.toMatchObject({ status: 409 });
  });

  it("soft-deletes and detaches an isolated imported artifact while preserving its revision history", async () => {
    const updateArtifacts = vi.fn(async () => ({ count: 1 }));
    const updateAttachments = vi.fn(async () => ({ count: 1 }));
    const service = new ArtifactRevisionsService();
    (service as any).db = { $transaction: (callback: any) => callback({
      builderArtifact: { findMany: vi.fn(async () => [{ id: "form-1" }]), updateMany: updateArtifacts },
      artifactDependency: { findMany: vi.fn(async () => []) },
      devPackageItem: { findMany: vi.fn(async () => []) },
      builderArtifactAttachment: { updateMany: updateAttachments },
    }) };
    await expect(service.softDeleteImportedProjectArtifacts({ tenantId: "tenant-1", projectId: "project-1", artifactIds: ["form-1"] })).resolves.toEqual({ deleted: ["form-1"] });
    expect(updateArtifacts).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "ARCHIVED", deletedAt: expect.any(Date) }) }));
    expect(updateAttachments).toHaveBeenCalledOnce();
  });

  it("runs a prevalidated project metadata mutation inside the mixed artifact transaction", async () => {
    const transactionMarker = {};
    const mutateProject = vi.fn(async (tx: any) => { expect(tx).toBe(transactionMarker); });
    const service = new ArtifactRevisionsService();
    Object.assign(transactionMarker, { devProject: { findFirst: vi.fn(async () => ({ id: "project-1" })) } });
    (service as any).db = { $transaction: (callback: any) => callback(transactionMarker) };
    await expect(service.applyImportedProjectCreateAndUpdate({ tenantId: "tenant-1", projectId: "project-1", additions: [], updates: [], mutateProject })).resolves.toEqual([]);
    expect(mutateProject).toHaveBeenCalledOnce();
  });
});
