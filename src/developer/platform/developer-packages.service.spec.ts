import { describe, expect, it, vi } from "vitest";
import { generateKeyPairSync, sign } from "node:crypto";

vi.mock("@kannan19302/database", () => ({ prisma: {} }));

import { DeveloperPackagesService } from "./developer-packages.service";
import { RuntimePlanCacheService } from "./runtime-plan-cache.service";

describe("DeveloperPackagesService", () => {
  it("creates an immutable draft version from an exact valid Library revision", async () => {
    const create = vi.fn(async ({ data }: any) => ({ id: "pv-1", ...data }));
    const db = {
      devPackage: { findFirst: vi.fn(async () => ({ id: "pkg-1", namespace: "com.acme.sales", name: "Sales", editability: "INTERNAL" })) },
      artifactRevision: { findFirst: vi.fn(async () => ({
        id: "rev-1", revision: 1, contentHash: "abc", validationStatus: "VALID",
        source: { capabilities: [] }, dependencies: [],
        artifact: { id: "artifact-1", artifactType: "FORM", ownerProjectId: null },
      })) },
      $transaction: (callback: any) => callback({
        devPackageVersion: { findFirst: vi.fn(async () => null), create },
      }),
    };
    const service = new DeveloperPackagesService();
    (service as any).db = db;
    const result = await service.createVersion({
      tenantId: "tenant-1", packageId: "pkg-1", version: "1.0.0",
      items: [{ artifactId: "artifact-1", revision: 1, exportName: "LeadForm" }],
    });
    expect(result.status).toBe("DRAFT");
    expect(result.manifest.items[0]).toMatchObject({ artifactId: "artifact-1", revision: 1, contentHash: "abc" });
    expect(result.contentHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("refuses to install an unsigned draft", async () => {
    const service = new DeveloperPackagesService();
    (service as any).db = {
      devProject: { findFirst: vi.fn(async () => ({ id: "project-1", kind: "APP" })) },
      devPackageVersion: { findFirst: vi.fn(async () => ({ id: "pv-1", package: { status: "ACTIVE" }, status: "DRAFT", signature: null, items: [] })) },
    };
    await expect(service.install({
      tenantId: "tenant-1", projectId: "project-1", packageVersionId: "pv-1", mode: "PINNED",
    })).rejects.toThrow(/signed, published/);
  });

  it("installs a compatible signed version and attaches its artifacts atomically", async () => {
    const createInstallation = vi.fn(async ({ data }: any) => ({ id: "install-1", ...data }));
    const attach = vi.fn(async () => ({ id: "attachment-1" }));
    const service = new DeveloperPackagesService();
    (service as any).db = {
      devProject: { findFirst: vi.fn(async () => ({ id: "project-1", kind: "APP" })) },
      devPackageVersion: { findFirst: vi.fn(async () => ({
        id: "pv-1", packageId: "pkg-1", version: "1.0.0", contentHash: "abc",
        package: { status: "ACTIVE" }, status: "PUBLISHED", signature: "signed", manifest: { dependencies: [] },
        requiredCapabilities: [],
        items: [{ artifactId: "artifact-1", artifact: { artifactType: "FORM" } }],
      })) },
      $transaction: (callback: any) => callback({
        projectInstallation: { create: createInstallation },
        builderArtifactAttachment: { upsert: attach },
      }),
    };
    const result = await service.install({
      tenantId: "tenant-1", projectId: "project-1", packageVersionId: "pv-1",
      mode: "PINNED", resourceMappings: {}, capabilityGrants: [], installedBy: "user-1",
    });
    expect(result.lock).toMatchObject({ packageId: "pkg-1", packageVersionId: "pv-1", contentHash: "abc" });
    expect(attach).toHaveBeenCalledOnce();
  });

  it("rejects project-owned artifacts from Library packages", async () => {
    const service = new DeveloperPackagesService();
    (service as any).db = {
      devPackage: { findFirst: vi.fn(async () => ({ id: "pkg-1" })) },
      artifactRevision: { findFirst: vi.fn(async () => ({
        artifact: { artifactType: "FORM", ownerProjectId: "project-1" },
      })) },
    };
    await expect(service.createVersion({
      tenantId: "tenant-1", packageId: "pkg-1", version: "1.0.0",
      items: [{ artifactId: "artifact-1", revision: 1, exportName: "LeadForm" }],
    })).rejects.toThrow(/project-owned/);
  });

  it("publishes only when an active Ed25519 key verifies the exact content hash", async () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const publicKeyDer = publicKey.export({ format: "der", type: "spki" }).toString("base64");
    const contentHash = "a".repeat(64);
    const signature = sign(null, Buffer.from(contentHash, "utf8"), privateKey).toString("base64");
    const update = vi.fn(async ({ data }: any) => ({ id: "pv-1", ...data }));
    const service = new DeveloperPackagesService();
    (service as any).db = {
      devPackageVersion: {
        findFirst: vi.fn(async () => ({ id: "pv-1", status: "DRAFT", contentHash })),
        update,
      },
      devSigningKey: {
        findFirst: vi.fn(async () => ({ keyId: "key-12345", publicKey: publicKeyDer, status: "ACTIVE" })),
      },
    };
    const result = await service.publishVersion({
      tenantId: "tenant-1", packageId: "pkg-1", packageVersionId: "pv-1",
      keyId: "key-12345", signature,
    });
    expect(result.status).toBe("PUBLISHED");
    expect(JSON.parse(result.signature)).toMatchObject({
      algorithm: "Ed25519", keyId: "key-12345", signedContentHash: contentHash,
    });
  });

  it("rejects a signature over different content", async () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const service = new DeveloperPackagesService();
    (service as any).db = {
      devPackageVersion: { findFirst: vi.fn(async () => ({ id: "pv-1", status: "DRAFT", contentHash: "a".repeat(64) })) },
      devSigningKey: { findFirst: vi.fn(async () => ({ publicKey: publicKey.export({ format: "der", type: "spki" }).toString("base64") })) },
    };
    const signature = sign(null, Buffer.from("b".repeat(64), "utf8"), privateKey).toString("base64");
    await expect(service.publishVersion({
      tenantId: "tenant-1", packageId: "pkg-1", packageVersionId: "pv-1",
      keyId: "key-12345", signature,
    })).rejects.toThrow(/signature is invalid/);
  });

  it("blocks removal when a project-owned artifact depends on a package export", async () => {
    const service = new DeveloperPackagesService();
    (service as any).db = {
      projectInstallation: {
        findFirst: vi.fn(async () => ({ id: "install-1", packageVersion: { items: [{ artifactId: "package-form" }] } })),
        findMany: vi.fn(async () => []),
      },
      artifactDependency: { findMany: vi.fn(async () => [{ alias: "sharedForm", targetArtifactId: "package-form", sourceRevision: { artifactId: "project-page", artifact: { ownerProjectId: "project-1" } } }]) },
    };
    await expect(service.remove("tenant-1", "project-1", "install-1")).rejects.toThrow(/would orphan/);
  });

  it("removes safely and detaches exports no remaining installation provides", async () => {
    const update = vi.fn(async ({ data }: any) => ({ status: data.status })); const detach = vi.fn(async () => ({ count: 1 }));
    const service = new DeveloperPackagesService();
    (service as any).db = {
      projectInstallation: { findFirst: vi.fn(async () => ({ id: "install-1", packageVersion: { items: [{ artifactId: "package-form" }] } })), findMany: vi.fn(async () => []) },
      artifactDependency: { findMany: vi.fn(async () => []) },
      $transaction: (callback: any) => callback({ projectInstallation: { update }, builderArtifactAttachment: { updateMany: detach } }),
    };
    await expect(service.remove("tenant-1", "project-1", "install-1")).resolves.toMatchObject({ status: "REMOVED" });
    expect(detach).toHaveBeenCalledOnce();
  });

  it("certifies only signed published versions with deployable validated artifacts", async () => {
    const create = vi.fn(async ({ data }: any) => data); const service = new DeveloperPackagesService();
    (service as any).db = { devPackageVersion: { findFirst: vi.fn(async () => ({ id: "pv-1", signature: "signed", licenseExpression: "MIT", sbomDigest: "a".repeat(64), vulnerabilityStatus: "CLEAN", items: [{ exportName: "Form", artifact: { artifactType: "FORM" }, revision: { validationStatus: "VALID" } }] })) }, packageCertification: { create } };
    await expect(service.certifyVersion({ tenantId: "tenant-1", packageId: "pkg-1", packageVersionId: "pv-1" })).resolves.toMatchObject({ status: "PASSED" });
  });

  it("fails marketplace certification without immutable security provenance", async () => {
    const create = vi.fn(async ({ data }: any) => data); const service = new DeveloperPackagesService();
    (service as any).db = { devPackageVersion: { findFirst: vi.fn(async () => ({ id: "pv-1", signature: "signed", licenseExpression: null, sbomDigest: null, vulnerabilityStatus: "UNKNOWN", items: [{ exportName: "Form", artifact: { artifactType: "FORM" }, revision: { validationStatus: "VALID" } }] })) }, packageCertification: { create } };
    await expect(service.certifyVersion({ tenantId: "tenant-1", packageId: "pkg-1", packageVersionId: "pv-1" })).resolves.toMatchObject({ status: "FAILED" });
  });

  it("requires passing certification before marketplace promotion", async () => {
    const service = new DeveloperPackagesService(); (service as any).db = { packageCertification: { findFirst: vi.fn(async () => null) } };
    await expect(service.promoteToMarketplace({ tenantId: "tenant-1", packageId: "pkg-1", packageVersionId: "pv-1" })).rejects.toThrow(/certification/);
  });

  it("suspends a package without deleting its immutable history", async () => {
    const update = vi.fn(async ({ data }: any) => data);
    const cache = new RuntimePlanCacheService();
    cache.set("tenant-1:project-1:env-1", { releaseId: "release-1" });
    const service = new DeveloperPackagesService(cache);
    (service as any).db = { devPackage: { findFirst: vi.fn(async () => ({ id: "pkg-1" })), update } };
    await expect(service.suspendPackage("tenant-1", "pkg-1")).resolves.toMatchObject({ status: "SUSPENDED", visibility: "PRIVATE" });
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ data: { status: "SUSPENDED", visibility: "PRIVATE" } }));
    expect(cache.get("tenant-1:project-1:env-1")).toBeUndefined();
  });

  it("revokes an active signing key so future verification fails closed", async () => {
    const update = vi.fn(async ({ data }: any) => data);
    const cache = new RuntimePlanCacheService();
    cache.set("tenant-1:project-1:env-1", { releaseId: "release-1" });
    const service = new DeveloperPackagesService(cache);
    (service as any).db = { devSigningKey: { findFirst: vi.fn(async () => ({ id: "key-row" })), update } };
    await expect(service.revokeSigningKey("tenant-1", "key-12345")).resolves.toMatchObject({ status: "REVOKED" });
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "key-row" } }));
    expect(cache.get("tenant-1:project-1:env-1")).toBeUndefined();
  });

  it("uses the cross-cell invalidation channel for an emergency package suspension", async () => {
    const invalidation = { invalidateTenant: vi.fn(async () => undefined) };
    const service = new DeveloperPackagesService(undefined, invalidation as any);
    (service as any).db = { devPackage: { findFirst: vi.fn(async () => ({ id: "pkg-1" })), update: vi.fn(async ({ data }: any) => data) } };
    await service.suspendPackage("tenant-1", "pkg-1");
    expect(invalidation.invalidateTenant).toHaveBeenCalledWith("tenant-1");
  });
});
