import { describe, expect, it, vi } from "vitest";
import { generateKeyPairSync, sign } from "node:crypto";

vi.mock("@kannan19302/database", () => ({ prisma: {} }));

import { RuntimeManifestService } from "./runtime-manifest.service";
import { releaseDigest } from "./project-releases.service";

function signedRelease() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const source = { apiVersion: "unierp.dev/v1", kind: "FORM", metadata: { id: "form-1", namespace: "test", name: "Form" }, spec: { title: "Lead", pages: [] }, interfaces: { inputs: [], outputs: [], events: [] }, dependencies: [], capabilities: [], tests: [], extensions: {} };
  const sourceHash = "source";
  const compiledHash = releaseDigest({ compiler: "compiler", sourceHash, source });
  const unsigned = {
    apiVersion: "unierp.release/v1", releaseId: "release-1", projectId: "project-1", projectRevision: "source",
    packages: [], artifacts: [{ artifactId: "form-1", revision: 1, sourceHash, compiledHash }], migrations: [],
    requiredBindings: [{ key: "crm", kind: "CONNECTOR", requiredCapabilities: ["binding:crm"] }], evidence: [],
    policy: { bundleVersion: "v1", decisions: [], approvals: [] },
    provenance: { builder: "builder", toolchain: "compiler", sbomDigest: "sbom" },
  };
  const manifestHash = releaseDigest(unsigned);
  const signature = sign(null, Buffer.from(manifestHash, "utf8"), privateKey).toString("base64");
  return {
    release: { id: "release-1", manifestHash, signature, signingKeyId: "key-1", snapshot: { ...unsigned, provenance: { ...unsigned.provenance, signature } } },
    publicKey: publicKey.export({ format: "der", type: "spki" }).toString("base64"),
  };
}

function artifactStore(release: any) {
  const pinned = release.snapshot.artifacts[0];
  return { builderArtifact: { findMany: vi.fn(async () => [{ id: pinned.artifactId, artifactType: "FORM", revisions: [{ revision: pinned.revision, contentHash: pinned.sourceHash, source: { apiVersion: "unierp.dev/v1", kind: "FORM", metadata: { id: "form-1", namespace: "test", name: "Form" }, spec: { title: "Lead", pages: [] }, interfaces: { inputs: [], outputs: [], events: [] }, dependencies: [], capabilities: [], tests: [], extensions: {} } }] }]) } };
}

describe("RuntimeManifestService", () => {
  it("resolves only the active signed release and verified non-secret references", async () => {
    const { release, publicKey } = signedRelease();
    const service = new RuntimeManifestService();
    (service as any).db = {
      ...artifactStore(release),
      environment: { findFirst: vi.fn(async () => ({ id: "env-1", metadata: { activeDeveloperRelease: { projectId: "project-1", releaseId: "release-1", manifestHash: release.manifestHash } } })) },
      projectRelease: { findFirst: vi.fn(async () => release) },
      devSigningKey: { findFirst: vi.fn(async () => ({ publicKey })) },
      environmentBinding: { findMany: vi.fn(async () => [{ key: "crm", kind: "CONNECTOR", reference: "connector://salesforce/prod", status: "VERIFIED" }]) },
    };
    const plan = await service.resolve({ tenantId: "tenant-1", projectId: "project-1", environmentId: "env-1" });
    expect(plan).toMatchObject({ releaseId: "release-1", bindings: [{ key: "crm", reference: "connector://salesforce/prod" }] });
    expect(Object.isFrozen(plan)).toBe(true);
  });

  it("refuses a tampered release even when the database row says it is active", async () => {
    const { release, publicKey } = signedRelease();
    release.snapshot.artifacts[0].compiledHash = "tampered";
    const service = new RuntimeManifestService();
    (service as any).db = {
      ...artifactStore(release),
      environment: { findFirst: vi.fn(async () => ({ id: "env-1", metadata: { activeDeveloperRelease: { projectId: "project-1", releaseId: "release-1", manifestHash: release.manifestHash } } })) },
      projectRelease: { findFirst: vi.fn(async () => release) }, devSigningKey: { findFirst: vi.fn(async () => ({ publicKey })) },
    };
    await expect(service.resolve({ tenantId: "tenant-1", projectId: "project-1", environmentId: "env-1" })).rejects.toThrow(/hash does not match/);
  });

  it("refuses runtime resolution when a package in an otherwise valid release is suspended", async () => {
    const { release, publicKey } = signedRelease();
    release.snapshot.packages = [{ packageId: "pkg-suspended", version: "1.0.0", contentHash: "hash", editability: "MANAGED" }];
    // Re-sign the amended immutable manifest just as release publication would.
    const unsigned = { ...release.snapshot, provenance: { ...release.snapshot.provenance } } as any;
    delete unsigned.provenance.signature;
    const manifestHash = releaseDigest(unsigned);
    // This test only needs a trusted signed release boundary; use a fresh keypair
    // rather than trying to recover the private key used by signedRelease().
    const keys = generateKeyPairSync("ed25519");
    const signature = sign(null, Buffer.from(manifestHash, "utf8"), keys.privateKey).toString("base64");
    release.manifestHash = manifestHash;
    release.signature = signature;
    release.snapshot.provenance.signature = signature;
    const service = new RuntimeManifestService();
    (service as any).db = {
      ...artifactStore(release),
      environment: { findFirst: vi.fn(async () => ({ id: "env-1", metadata: { activeDeveloperRelease: { projectId: "project-1", releaseId: "release-1", manifestHash } } })) },
      projectRelease: { findFirst: vi.fn(async () => release) },
      devSigningKey: { findFirst: vi.fn(async () => ({ publicKey: keys.publicKey.export({ format: "der", type: "spki" }).toString("base64") })) },
      devPackage: { findMany: vi.fn(async () => []) },
    };
    await expect(service.resolve({ tenantId: "tenant-1", projectId: "project-1", environmentId: "env-1" })).rejects.toThrow(/suspended or unavailable/);
  });

  it("returns the control-plane persisted cell placement when the assignment service is available", async () => {
    const { release, publicKey } = signedRelease();
    const assignment = { placement: vi.fn(async () => ({ cellId: "ap-south-cell-02", shard: 2, region: "ap-south", topologyVersion: "v2" })) };
    const service = new RuntimeManifestService(undefined, assignment as any);
    (service as any).db = {
      ...artifactStore(release),
      environment: { findFirst: vi.fn(async () => ({ id: "env-1", metadata: { activeDeveloperRelease: { projectId: "project-1", releaseId: "release-1", manifestHash: release.manifestHash } } })) },
      projectRelease: { findFirst: vi.fn(async () => release) },
      devSigningKey: { findFirst: vi.fn(async () => ({ publicKey })) },
      environmentBinding: { findMany: vi.fn(async () => [{ key: "crm", kind: "CONNECTOR", reference: "connector://salesforce/prod", status: "VERIFIED" }]) },
    };
    await expect(service.resolve({ tenantId: "tenant-1", projectId: "project-1", environmentId: "env-1" })).resolves.toMatchObject({ placement: { cellId: "ap-south-cell-02", topologyVersion: "v2" } });
  });

  it("uses only a short-lived previously verified plan when the control plane is unexpectedly unavailable", async () => {
    const { release, publicKey } = signedRelease();
    const service = new RuntimeManifestService();
    const environment = { findFirst: vi.fn(async () => ({ id: "env-1", metadata: { activeDeveloperRelease: { projectId: "project-1", releaseId: "release-1", manifestHash: release.manifestHash } } })) };
    (service as any).db = {
      ...artifactStore(release),
      environment,
      projectRelease: { findFirst: vi.fn(async () => release) },
      devSigningKey: { findFirst: vi.fn(async () => ({ publicKey })) },
      environmentBinding: { findMany: vi.fn(async () => [{ key: "crm", kind: "CONNECTOR", reference: "connector://salesforce/prod", status: "VERIFIED" }]) },
    };
    const first = await service.resolve({ tenantId: "tenant-1", projectId: "project-1", environmentId: "env-1" });
    environment.findFirst.mockRejectedValueOnce(new Error("control plane unavailable"));
    await expect(service.resolve({ tenantId: "tenant-1", projectId: "project-1", environmentId: "env-1" })).resolves.toBe(first);
  });

  it("does not use cache to bypass an explicit invalid release policy result", async () => {
    const { release, publicKey } = signedRelease();
    const service = new RuntimeManifestService();
    const environment = { findFirst: vi.fn(async () => ({ id: "env-1", metadata: { activeDeveloperRelease: { projectId: "project-1", releaseId: "release-1", manifestHash: release.manifestHash } } })) };
    (service as any).db = {
      ...artifactStore(release),
      environment,
      projectRelease: { findFirst: vi.fn(async () => release) },
      devSigningKey: { findFirst: vi.fn(async () => ({ publicKey })) },
      environmentBinding: { findMany: vi.fn(async () => [{ key: "crm", kind: "CONNECTOR", reference: "connector://salesforce/prod", status: "VERIFIED" }]) },
    };
    await service.resolve({ tenantId: "tenant-1", projectId: "project-1", environmentId: "env-1" });
    environment.findFirst.mockResolvedValueOnce(null);
    await expect(service.resolve({ tenantId: "tenant-1", projectId: "project-1", environmentId: "env-1" })).rejects.toThrow(/Active environment not found/);
  });

  it("hydrates only the exact immutable artifact revision and verifies both hashes", async () => {
    const { release, publicKey } = signedRelease();
    const store = artifactStore(release);
    const service = new RuntimeManifestService();
    (service as any).db = { ...store, environment: { findFirst: vi.fn(async () => ({ id: "env-1", metadata: { activeDeveloperRelease: { projectId: "project-1", releaseId: "release-1", manifestHash: release.manifestHash } } })) }, projectRelease: { findFirst: vi.fn(async () => release) }, devSigningKey: { findFirst: vi.fn(async () => ({ publicKey })) }, environmentBinding: { findMany: vi.fn(async () => [{ key: "crm", kind: "CONNECTOR", reference: "connector://crm", status: "VERIFIED" }]) } };
    const plan = await service.resolve({ tenantId: "tenant-1", projectId: "project-1", environmentId: "env-1" });
    expect(plan.artifacts[0]).toMatchObject({ artifactId: "form-1", kind: "FORM", source: { kind: "FORM", spec: { title: "Lead" } } });
    expect(store.builderArtifact.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ tenantId: "tenant-1", id: { in: ["form-1"] } }) }));
  });

  it("fails closed when a pinned artifact revision is missing", async () => {
    const { release, publicKey } = signedRelease();
    const service = new RuntimeManifestService();
    (service as any).db = { builderArtifact: { findMany: vi.fn(async () => []) }, environment: { findFirst: vi.fn(async () => ({ id: "env-1", metadata: { activeDeveloperRelease: { projectId: "project-1", releaseId: "release-1", manifestHash: release.manifestHash } } })) }, projectRelease: { findFirst: vi.fn(async () => release) }, devSigningKey: { findFirst: vi.fn(async () => ({ publicKey })) } };
    await expect(service.resolve({ tenantId: "tenant-1", projectId: "project-1", environmentId: "env-1" })).rejects.toThrow(/Pinned artifact revision is unavailable/);
  });
});
