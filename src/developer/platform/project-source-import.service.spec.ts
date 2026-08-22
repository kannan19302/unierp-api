import { describe, expect, it, vi } from "vitest";
import { ProjectSourceImportService } from "./project-source-import.service";
import { releaseDigest } from "./project-releases.service";
import { artifactContentHash } from "./artifact-revisions.service";
const source = { apiVersion: "unierp.dev/v1", kind: "FORM", metadata: { id: "form-1", namespace: "com.acme", name: "Form" }, spec: {}, dependencies: [], capabilities: [], tests: [], interfaces: {}, extensions: {} };
const sourceHash = artifactContentHash(source as any);
describe("ProjectSourceImportService", () => {
  it("verifies bundle integrity and calculates a revision update plan", async () => {
    const releases = { currentComposition: vi.fn(async () => ({ fingerprint: "fp", artifacts: [{ artifactId: "form-1", revision: 2, sourceHash: "old" }] })) };
    const service = new ProjectSourceImportService(releases as any, {} as any);
    const bundle: any = { apiVersion: "unierp.project-source/v1", projectId: "project-1", sourceFingerprint: "fp", packages: [], requiredBindings: [], artifacts: [{ id: "form-1", kind: "FORM", revision: 2, contentHash: sourceHash, source }] };
    bundle.bundleHash = releaseDigest(bundle);
    await expect(service.plan("tenant-1", "project-1", bundle)).resolves.toMatchObject({ baseFingerprint: "fp", changes: { changed: [{ id: "form-1", expectedRevision: 2, incomingRevision: 2, from: "old", to: sourceHash }] } });
  });
  it("rejects tampered source bundles", async () => {
    const service = new ProjectSourceImportService({ currentComposition: vi.fn() } as any, {} as any);
    await expect(service.plan("tenant-1", "project-1", { apiVersion: "unierp.project-source/v1", projectId: "project-1", artifacts: [], bundleHash: "not-a-real-hash" })).rejects.toThrow(/hash/);
  });
  it("rejects a bundle whose per-artifact hash does not represent its source", async () => {
    const service = new ProjectSourceImportService({ currentComposition: vi.fn() } as any, {} as any);
    const bundle: any = { apiVersion: "unierp.project-source/v1", projectId: "project-1", sourceFingerprint: "old-fp", packages: [], requiredBindings: [], artifacts: [{ id: "form-1", kind: "FORM", revision: 1, contentHash: "0".repeat(64), source }] };
    bundle.bundleHash = releaseDigest(bundle);
    await expect(service.plan("tenant-1", "project-1", bundle)).rejects.toThrow(/Content hash does not match source/);
  });
  it("rejects a valid but stale source bundle before it can overwrite current work", async () => {
    const releases = { currentComposition: vi.fn(async () => ({ fingerprint: "current", artifacts: [] })) };
    const service = new ProjectSourceImportService(releases as any, {} as any);
    const bundle: any = { apiVersion: "unierp.project-source/v1", projectId: "project-1", sourceFingerprint: "stale", packages: [], requiredBindings: [], artifacts: [] };
    bundle.bundleHash = releaseDigest(bundle);
    await expect(service.plan("tenant-1", "project-1", bundle)).rejects.toThrow(/base fingerprint is stale/);
  });
  it("returns structured package-lock and binding conflicts instead of silently ignoring drift", async () => {
    const releases = { currentComposition: vi.fn(async () => ({ fingerprint: "fp", artifacts: [], packages: [{ packageId: "core", version: "1.0.0", contentHash: "1".repeat(64), editability: "MANAGED" }], requiredBindings: [] })) };
    const service = new ProjectSourceImportService(releases as any, {} as any);
    const bundle: any = { apiVersion: "unierp.project-source/v1", projectId: "project-1", sourceFingerprint: "fp", packages: [{ packageId: "core", version: "2.0.0", contentHash: "2".repeat(64), editability: "MANAGED" }], requiredBindings: [], artifacts: [] };
    bundle.bundleHash = releaseDigest(bundle);
    await expect(service.plan("tenant-1", "project-1", bundle)).resolves.toMatchObject({ conflicts: expect.arrayContaining([expect.objectContaining({ domain: "PACKAGE_LOCK", change: "CHANGE", applyIncomingReady: false })]), requiresConfirmation: true });
  });
  it("requires an explicit resolution for every dependency conflict and never guesses incoming mappings", async () => {
    const revisions = { createBatch: vi.fn(async () => []) };
    const audit = { record: vi.fn(async () => undefined) };
    const releases = { currentComposition: vi.fn(async () => ({ fingerprint: "fp", artifacts: [], packages: [{ packageId: "pkg", version: "1.0.0", contentHash: "1".repeat(64), editability: "MANAGED" }], requiredBindings: [{ key: "crm", kind: "SERVICE", requiredCapabilities: [] }] })) };
    const service = new ProjectSourceImportService(releases as any, revisions as any, audit as any);
    const bundle: any = { apiVersion: "unierp.project-source/v1", projectId: "project-1", sourceFingerprint: "fp", packages: [{ packageId: "pkg", version: "2.0.0", contentHash: "2".repeat(64), editability: "MANAGED" }], requiredBindings: [], artifacts: [] }; bundle.bundleHash = releaseDigest(bundle);
    const plan = await service.plan("tenant-1", "project-1", bundle);
    await expect(service.apply("tenant-1", "project-1", bundle, "user-1")).rejects.toThrow(/explicit resolution/);
    const keep = Object.fromEntries(plan.conflicts.map((conflict: any) => [conflict.id, "KEEP_CURRENT"]));
    await expect(service.apply("tenant-1", "project-1", bundle, "user-1", keep)).resolves.toEqual([]);
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: "PROJECT_SOURCE_IMPORTED", actorId: "user-1", metadata: expect.objectContaining({ bundleHash: bundle.bundleHash, conflictResolutions: expect.arrayContaining([expect.objectContaining({ resolution: "KEEP_CURRENT" })]) }) }));
    await expect(service.apply("tenant-1", "project-1", bundle, "user-1", { ...keep, [plan.conflicts[0].id]: "APPLY_INCOMING" })).rejects.toThrow(/requires governed package mappings/);
  });
  it("applies only confirmed revision updates as one batch", async () => {
    const revisions = { createBatch: vi.fn(async (input: any) => input.changes) };
    const releases = { currentComposition: vi.fn(async () => ({ fingerprint: "fp", artifacts: [{ artifactId: "form-1", revision: 2, sourceHash: "old" }] })) };
    const service = new ProjectSourceImportService(releases as any, revisions as any);
    const bundle: any = { apiVersion: "unierp.project-source/v1", projectId: "project-1", sourceFingerprint: "fp", packages: [], requiredBindings: [], artifacts: [{ id: "form-1", kind: "FORM", revision: 2, contentHash: sourceHash, source }] }; bundle.bundleHash = releaseDigest(bundle);
    await expect(service.apply("tenant-1", "project-1", bundle, "user-1")).resolves.toHaveLength(1);
    expect(revisions.createBatch).toHaveBeenCalledWith(expect.objectContaining({ scope: { kind: "PROJECT", projectId: "project-1" }, createdBy: "user-1" }));
  });
  it("creates new canonical project artifact identities transactionally from a verified bundle", async () => {
    const revisions = { createImportedProjectArtifacts: vi.fn(async (input: any) => input.artifacts) };
    const releases = { currentComposition: vi.fn(async () => ({ fingerprint: "fp", artifacts: [] })) };
    const service = new ProjectSourceImportService(releases as any, revisions as any);
    const added = { ...source, metadata: { ...source.metadata, id: "form-new", name: "New Form" } };
    const bundle: any = { apiVersion: "unierp.project-source/v1", projectId: "project-1", sourceFingerprint: "fp", packages: [], requiredBindings: [], artifacts: [{ id: "form-new", kind: "FORM", revision: 1, contentHash: artifactContentHash(added as any), source: added }] }; bundle.bundleHash = releaseDigest(bundle);
    await expect(service.apply("tenant-1", "project-1", bundle, "user-1")).resolves.toHaveLength(1);
    expect(revisions.createImportedProjectArtifacts).toHaveBeenCalledWith(expect.objectContaining({ projectId: "project-1", createdBy: "user-1" }));
  });
  it("soft-deletes only an isolated project artifact when it is omitted from a verified bundle", async () => {
    const revisions = { softDeleteImportedProjectArtifacts: vi.fn(async (input: any) => ({ deleted: input.artifactIds })) };
    const releases = { currentComposition: vi.fn(async () => ({ fingerprint: "fp", artifacts: [{ artifactId: "form-1", revision: 1, sourceHash: "old" }] })) };
    const service = new ProjectSourceImportService(releases as any, revisions as any);
    const bundle: any = { apiVersion: "unierp.project-source/v1", projectId: "project-1", sourceFingerprint: "fp", packages: [], requiredBindings: [], artifacts: [] }; bundle.bundleHash = releaseDigest(bundle);
    await expect(service.apply("tenant-1", "project-1", bundle, "user-1")).resolves.toEqual({ deleted: ["form-1"] });
    expect(revisions.softDeleteImportedProjectArtifacts).toHaveBeenCalledWith({ tenantId: "tenant-1", projectId: "project-1", artifactIds: ["form-1"] });
  });
  it("applies additions and revisions through one mixed-import transaction", async () => {
    const revisions = { applyImportedProjectCreateAndUpdate: vi.fn(async (input: any) => input.additions) };
    const releases = { currentComposition: vi.fn(async () => ({ fingerprint: "fp", artifacts: [{ artifactId: "form-1", revision: 1, sourceHash: "old" }] })) };
    const service = new ProjectSourceImportService(releases as any, revisions as any);
    const added = { ...source, metadata: { ...source.metadata, id: "form-new", name: "New Form" } };
    const bundle: any = { apiVersion: "unierp.project-source/v1", projectId: "project-1", sourceFingerprint: "fp", packages: [], requiredBindings: [], artifacts: [{ id: "form-1", kind: "FORM", revision: 1, contentHash: sourceHash, source }, { id: "form-new", kind: "FORM", revision: 1, contentHash: artifactContentHash(added as any), source: added }] }; bundle.bundleHash = releaseDigest(bundle);
    await expect(service.apply("tenant-1", "project-1", bundle, "user-1")).resolves.toHaveLength(1);
    expect(revisions.applyImportedProjectCreateAndUpdate).toHaveBeenCalledWith(expect.objectContaining({ additions: expect.any(Array), updates: expect.any(Array) }));
  });
  it("includes removals in the same guarded mixed-import transaction", async () => {
    const revisions = { applyImportedProjectCreateAndUpdate: vi.fn(async (input: any) => input.updates) };
    const releases = { currentComposition: vi.fn(async () => ({ fingerprint: "fp", artifacts: [{ artifactId: "form-1", revision: 1, sourceHash: "old" }, { artifactId: "form-remove", revision: 1, sourceHash: "gone" }] })) };
    const service = new ProjectSourceImportService(releases as any, revisions as any);
    const bundle: any = { apiVersion: "unierp.project-source/v1", projectId: "project-1", sourceFingerprint: "fp", packages: [], requiredBindings: [], artifacts: [{ id: "form-1", kind: "FORM", revision: 1, contentHash: sourceHash, source }] }; bundle.bundleHash = releaseDigest(bundle);
    await expect(service.apply("tenant-1", "project-1", bundle, "user-1")).resolves.toHaveLength(1);
    expect(revisions.applyImportedProjectCreateAndUpdate).toHaveBeenCalledWith(expect.objectContaining({ removals: ["form-remove"], updates: expect.any(Array) }));
  });
});
