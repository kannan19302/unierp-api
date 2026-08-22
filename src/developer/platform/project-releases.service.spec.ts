import { describe, expect, it, vi } from "vitest";
import { generateKeyPairSync, sign } from "node:crypto";

vi.mock("@kannan19302/database", () => ({ prisma: {} }));

import { ProjectReleasesService } from "./project-releases.service";

const project = { id: "project-1", kind: "APP" };
const artifact = {
  id: "artifact-1", artifactType: "FORM",
  revisions: [{
    id: "revision-1", revision: 3, contentHash: "source-hash", validationStatus: "VALID",
    source: { apiVersion: "unierp.dev/v1", kind: "FORM", spec: { title: "Lead" } }, dependencies: [],
  }],
};

function baseDb() {
  return {
    devProject: { findFirst: vi.fn(async () => project) },
    builderArtifact: { findMany: vi.fn(async () => [artifact]) },
    projectInstallation: { findMany: vi.fn(async () => []) },
  } as any;
}

describe("ProjectReleasesService", () => {
  it.each([
    { projectKind: "APP", artifactKind: "FORM", spec: { title: "Lead intake", pages: [] } },
    { projectKind: "SITE", artifactKind: "PAGE", spec: { title: "Home", slug: "/", sections: [] } },
  ])("validates the $projectKind/$artifactKind pilot through the canonical release path", async ({ projectKind, artifactKind, spec }) => {
    const db = baseDb();
    db.devProject.findFirst = vi.fn(async () => ({ id: `project-${projectKind.toLowerCase()}`, kind: projectKind }));
    db.builderArtifact.findMany = vi.fn(async () => [{
      id: `artifact-${artifactKind.toLowerCase()}`, artifactType: artifactKind,
      revisions: [{ id: "revision-1", revision: 1, contentHash: "source-hash", validationStatus: "VALID", source: { apiVersion: "unierp.dev/v1", kind: artifactKind, metadata: { id: `artifact-${artifactKind.toLowerCase()}`, namespace: "com.acme", name: artifactKind }, spec, interfaces: { inputs: [], outputs: [], events: [] }, dependencies: [], capabilities: [], tests: [], extensions: {} }, dependencies: [] }],
    }]);
    db.artifactBuild = { upsert: vi.fn(async ({ create }: any) => ({ id: `build-${artifactKind}`, ...create })) };
    db.projectValidationRun = { create: vi.fn(async ({ data }: any) => ({ id: `validation-${artifactKind}`, ...data })) };
    const service = new ProjectReleasesService(); (service as any).db = db;

    const result = await service.validate({ tenantId: "tenant-1", projectId: `project-${projectKind.toLowerCase()}` });

    expect(result).toMatchObject({ status: "PASSED", score: 100 });
    expect(result.evidence).toContainEqual(expect.objectContaining({ kind: "ARTIFACT_BUILD", id: `build-${artifactKind}` }));
  });

  it("validates the exact composition and persists deterministic build evidence", async () => {
    const db = baseDb();
    db.artifactBuild = { upsert: vi.fn(async ({ create }: any) => ({ id: "build-1", ...create })) };
    db.projectValidationRun = { create: vi.fn(async ({ data }: any) => ({ id: "validation-1", ...data })) };
    const service = new ProjectReleasesService(); (service as any).db = db;

    const result = await service.validate({ tenantId: "tenant-1", projectId: project.id, startedBy: "user-1" });

    expect(result.status).toBe("PASSED");
    expect(result.score).toBe(100);
    expect(result.sourceFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(result.evidence).toContainEqual({ kind: "ARTIFACT_BUILD", id: "build-1", digest: expect.stringMatching(/^[a-f0-9]{64}$/) });
    expect(result.evidence).toContainEqual(expect.objectContaining({ kind: "GOVERNOR_PASS", id: "artifacts" }));
  });

  it("rejects publish when the current fingerprint has no passed validation", async () => {
    const db = baseDb();
    db.projectValidationRun = { findFirst: vi.fn(async () => null) };
    const service = new ProjectReleasesService(); (service as any).db = db;
    await expect(service.publish({ tenantId: "tenant-1", projectId: project.id, version: "1.0.0", keyId: "key-1", signature: "bad" })).rejects.toThrow(/exact current project composition/);
  });

  it("fails validation when an artifact is not backed by a deployable builder manifest", async () => {
    const db = baseDb();
    db.builderArtifact.findMany = vi.fn(async () => [{ ...artifact, artifactType: "RETIRED_KIND" }]);
    db.artifactBuild = { upsert: vi.fn(async ({ create }: any) => ({ id: "build-1", ...create })) };
    db.projectValidationRun = { create: vi.fn(async ({ data }: any) => data) };
    const service = new ProjectReleasesService(); (service as any).db = db;
    const result = await service.validate({ tenantId: "tenant-1", projectId: project.id });
    expect(result.status).toBe("FAILED");
    expect(result.checks).toContainEqual(expect.objectContaining({ id: "builders.runtime-supported", status: "FAIL" }));
  });

  it("fails validation when resolved artifact dependencies form a cycle", async () => {
    const db = baseDb();
    db.builderArtifact.findMany = vi.fn(async () => [
      { ...artifact, revisions: [{ ...artifact.revisions[0], dependencies: [{ targetArtifactId: "artifact-2" }] }] },
      { ...artifact, id: "artifact-2", revisions: [{ ...artifact.revisions[0], id: "revision-2", dependencies: [{ targetArtifactId: "artifact-1" }] }] },
    ]);
    db.artifactBuild = { upsert: vi.fn(async ({ create }: any) => ({ id: create.revisionId, ...create })) };
    db.projectValidationRun = { create: vi.fn(async ({ data }: any) => data) };
    const service = new ProjectReleasesService(); (service as any).db = db;
    const result = await service.validate({ tenantId: "tenant-1", projectId: project.id });
    expect(result.status).toBe("FAILED");
    expect(result.checks).toContainEqual(expect.objectContaining({ id: "dependencies.acyclic", status: "FAIL" }));
  });

  it("verifies an Ed25519 signature over the environment-independent manifest hash", async () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const db = baseDb();
    const service = new ProjectReleasesService(); (service as any).db = db;
    const evidence = [{ kind: "ARTIFACT_BUILD", id: "build-1", digest: "compiled" }];
    db.projectValidationRun = { findFirst: vi.fn(async () => ({ score: 100, evidence })) };
    db.devSigningKey = { findFirst: vi.fn(async () => ({ publicKey: publicKey.export({ format: "der", type: "spki" }).toString("base64") })) };
    db.projectRelease = { create: vi.fn(async ({ data }: any) => data) };
    const prepared = await service.preparePublish({ tenantId: "tenant-1", projectId: project.id, version: "1.0.0" });
    const signature = sign(null, Buffer.from(prepared.manifestHash, "utf8"), privateKey).toString("base64");

    const release = await service.publish({ tenantId: "tenant-1", projectId: project.id, version: "1.0.0", keyId: "key-1", signature, releaseId: prepared.unsigned.releaseId });
    expect(release.snapshot).not.toHaveProperty("environmentClass");
    expect(release.manifestHash).toBe(prepared.manifestHash);
  });

  it("requires two distinct approvals for production", async () => {
    const service = new ProjectReleasesService();
    (service as any).db = {
      projectRelease: { findFirst: vi.fn(async () => ({ id: "release-1", status: "PUBLISHED", snapshot: validManifest(), manifestHash: "hash" })) },
      environment: { findFirst: vi.fn(async () => ({ id: "prod", name: "Production", type: "PRODUCTION", status: "ACTIVE", metadata: {} })) },
    };
    await expect(service.deploy({ tenantId: "tenant-1", projectId: project.id, releaseId: "release-1", environmentId: "prod", deployedBy: "user-1", approvals: [{ userId: "same" }, { userId: "same" }] })).rejects.toThrow(/two distinct.*approvals/);
  });

  it("blocks deployment until every required environment binding is verified", async () => {
    const service = new ProjectReleasesService();
    (service as any).db = {
      projectRelease: { findFirst: vi.fn(async () => ({ id: "release-1", status: "PUBLISHED", snapshot: validManifest([{ key: "crm", kind: "SERVICE", requiredCapabilities: [] }]), manifestHash: "hash" })) },
      environment: { findFirst: vi.fn(async () => ({ id: "test", name: "Test", type: "STAGING", status: "ACTIVE", metadata: {} })) },
      environmentBinding: { findMany: vi.fn(async () => [{ key: "crm", status: "UNVERIFIED" }]) },
    };
    await expect(service.deploy({ tenantId: "tenant-1", projectId: project.id, releaseId: "release-1", environmentId: "test", deployedBy: "user-1" })).rejects.toThrow(/missing or unverified: crm/);
  });

  it("atomically activates a verified release and records forward rollback lineage", async () => {
    const create = vi.fn(async ({ data }: any) => ({ id: "deployment-new", ...data }));
    const environmentUpdate = vi.fn(async () => undefined);
    const deploymentUpdate = vi.fn(async () => undefined);
    const service = new ProjectReleasesService();
    (service as any).db = {
      projectRelease: { findFirst: vi.fn(async () => ({ id: "release-old", version: "1.0.0", status: "PUBLISHED", snapshot: validManifest(), manifestHash: "hash-old" })) },
      environment: { findFirst: vi.fn(async () => ({ id: "test", name: "Test", type: "STAGING", status: "ACTIVE", metadata: { retained: true, activeDeveloperRelease: { deploymentId: "deployment-current" } } })) },
      environmentBinding: { findMany: vi.fn(async () => []) },
      $transaction: (callback: any) => callback({ deployment: { create, update: deploymentUpdate }, environment: { update: environmentUpdate } }),
    };
    const result = await service.deploy({ tenantId: "tenant-1", projectId: project.id, releaseId: "release-old", environmentId: "test", deployedBy: "user-1", rollbackFrom: "deployment-current" });
    expect(result.status).toBe("SUCCESS");
    expect(create.mock.calls[0][0].data.stages.create).toHaveLength(2);
    expect(environmentUpdate.mock.calls[0][0].data.metadata).toMatchObject({ retained: true, activeDeveloperRelease: { releaseId: "release-old", deploymentId: "deployment-new" } });
    expect(deploymentUpdate).toHaveBeenCalledWith({ where: { id: "deployment-current" }, data: { status: "ROLLED_BACK", rollbackTo: "deployment-new" } });
  });

  it("rejects rollback of a deployment that is no longer active", async () => {
    const service = new ProjectReleasesService();
    (service as any).db = { deployment: { findFirst: vi.fn(async () => ({ id: "deployment-old", environmentId: "env-1", releaseId: "release-2", status: "SUCCESS" })) }, environment: { findFirst: vi.fn(async () => ({ id: "env-1", status: "ACTIVE", metadata: { activeDeveloperRelease: { deploymentId: "deployment-current" } } })) } };
    await expect(service.rollbackDeployment({ tenantId: "tenant-1", projectId: project.id, deploymentId: "deployment-old", targetReleaseId: "release-1", deployedBy: "user-1" })).rejects.toThrow(/currently active/);
  });

  it("allows rollback only to an older published release and invalidates runtime plans", async () => {
    const invalidateTenant = vi.fn(async () => undefined);
    const service = new ProjectReleasesService(undefined, undefined, { invalidateTenant } as any);
    const currentDeployment = { id: "deployment-2", environmentId: "env-1", releaseId: "release-2", strategy: "ROLLING", status: "SUCCESS" };
    const currentRelease = { id: "release-2", publishedAt: new Date("2026-02-01") };
    const targetRelease = { id: "release-1", version: "1.0.0", status: "PUBLISHED", publishedAt: new Date("2026-01-01"), snapshot: validManifest(), manifestHash: "hash-old" };
    const environment = { id: "env-1", name: "Test", type: "STAGING", status: "ACTIVE", metadata: { activeDeveloperRelease: { deploymentId: "deployment-2", releaseId: "release-2" } } };
    const deploymentCreate = vi.fn(async ({ data }: any) => ({ id: "deployment-rollback", ...data }));
    (service as any).db = {
      deployment: { findFirst: vi.fn(async () => currentDeployment) }, environment: { findFirst: vi.fn(async () => environment) },
      projectRelease: { findFirst: vi.fn(async ({ where }: any) => where.id === "release-2" ? currentRelease : targetRelease) }, environmentBinding: { findMany: vi.fn(async () => []) },
      $transaction: (callback: any) => callback({ $executeRawUnsafe: vi.fn(), environment: { findFirst: vi.fn(async () => environment), update: vi.fn() }, deployment: { create: deploymentCreate, update: vi.fn() } }),
    };
    await expect(service.rollbackDeployment({ tenantId: "tenant-1", projectId: project.id, deploymentId: "deployment-2", targetReleaseId: "release-1", deployedBy: "user-1" })).resolves.toMatchObject({ id: "deployment-rollback", rollbackFrom: "deployment-2" });
    expect(invalidateTenant).toHaveBeenCalledWith("tenant-1");
  });
});

function validManifest(requiredBindings: any[] = []) {
  return {
    apiVersion: "unierp.release/v1", releaseId: "release-1", projectId: project.id, projectRevision: "fingerprint",
    packages: [], artifacts: [], migrations: [], requiredBindings, evidence: [],
    policy: { bundleVersion: "v1", decisions: [], approvals: [] },
    provenance: { builder: "builder", toolchain: "compiler", sbomDigest: "digest", signature: "signature" },
  };
}
