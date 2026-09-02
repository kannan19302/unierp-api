import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { createHash, createPublicKey, verify } from "node:crypto";
import { prisma } from "@kannan19302/database";
import {
  builderManifestForKind,
  type CanonicalArtifactKind,
  type InstallationMode,
  type PackageEditability,
} from "@kannan19302/contracts";
import { RuntimePlanCacheService } from "./runtime-plan-cache.service";
import { RuntimePlanCacheInvalidationService } from "./runtime-plan-cache-invalidation.service";

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/;
const NAMESPACE = /^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9-]*)+$/;

function canonical(value: unknown): string {
  const normalize = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(normalize);
    if (item && typeof item === "object") {
      return Object.fromEntries(
        Object.entries(item as Record<string, unknown>)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, child]) => [key, normalize(child)]),
      );
    }
    return item;
  };
  return JSON.stringify(normalize(value));
}

function digest(value: unknown): string {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

@Injectable()
export class DeveloperPackagesService {
  private readonly db = prisma as any;
  constructor(private readonly runtimeCache?: RuntimePlanCacheService, private readonly runtimeInvalidation?: RuntimePlanCacheInvalidationService) {}
  private async invalidateRuntimePlans(tenantId: string) {
    if (this.runtimeInvalidation) return this.runtimeInvalidation.invalidateTenant(tenantId);
    this.runtimeCache?.invalidateTenant(tenantId);
  }

  list(tenantId: string) {
    return this.db.devPackage.findMany({
      where: { tenantId, status: { not: "DELETED" } },
      include: {
        versions: {
          where: { status: "PUBLISHED" },
          orderBy: { publishedAt: "desc" },
          include: {
            items: { include: { artifact: true, revision: true } },
            // The latest certification is enough for catalog decisions.  Keep
            // the full evidence in the certification endpoint/audit trail.
            certifications: {
              orderBy: { certifiedAt: "desc" },
              take: 1,
            },
          },
        },
      },
      orderBy: { updatedAt: "desc" },
    });
  }

  listInstallations(tenantId: string, projectId: string) {
    return this.db.projectInstallation.findMany({
      where: { tenantId, projectId, removedAt: null },
      include: {
        package: true,
        packageVersion: { include: { items: { include: { artifact: true } } } },
      },
      orderBy: { installedAt: "desc" },
    });
  }

  async createPackage(input: {
    tenantId: string;
    namespace: string;
    name: string;
    description?: string;
    editability: PackageEditability;
    createdBy?: string | null;
  }) {
    if (!NAMESPACE.test(input.namespace)) {
      throw new BadRequestException("Namespace must be reverse-domain style, for example com.acme.sales");
    }
    return this.db.devPackage.create({
      data: {
        tenantId: input.tenantId,
        namespace: input.namespace,
        name: input.name,
        description: input.description ?? null,
        editability: input.editability,
        createdBy: input.createdBy ?? null,
      },
    });
  }

  async registerSigningKey(input: {
    tenantId: string;
    keyId: string;
    publicKey: string;
    label: string;
    createdBy?: string | null;
  }) {
    try {
      const key = createPublicKey({
        key: Buffer.from(input.publicKey, "base64"),
        format: "der",
        type: "spki",
      });
      if (key.asymmetricKeyType !== "ed25519") {
        throw new Error("not Ed25519");
      }
    } catch {
      throw new BadRequestException("publicKey must be a base64 DER SPKI Ed25519 public key");
    }
    return this.db.devSigningKey.create({
      data: {
        tenantId: input.tenantId,
        keyId: input.keyId,
        publicKey: input.publicKey,
        label: input.label,
        createdBy: input.createdBy ?? null,
      },
    });
  }

  listSigningKeys(tenantId: string) {
    return this.db.devSigningKey.findMany({
      where: { tenantId },
      select: { id: true, keyId: true, label: true, status: true, createdAt: true, createdBy: true, revokedAt: true },
      orderBy: { createdAt: "desc" },
    });
  }

  async revokeSigningKey(tenantId: string, keyId: string) {
    const key = await this.db.devSigningKey.findFirst({ where: { tenantId, keyId, status: "ACTIVE", revokedAt: null } });
    if (!key) throw new NotFoundException("Active signing key not found");
    const revoked = await this.db.devSigningKey.update({ where: { id: key.id }, data: { status: "REVOKED", revokedAt: new Date() } });
    await this.invalidateRuntimePlans(tenantId);
    return revoked;
  }

  async createVersion(input: {
    tenantId: string;
    packageId: string;
    version: string;
    items: Array<{ artifactId: string; revision: number; exportName: string }>;
    licenseExpression?: string | null;
    sbomDigest?: string | null;
    vulnerabilityStatus?: "UNKNOWN" | "CLEAN" | "ADVISORY" | "BLOCKED";
    vulnerabilityReport?: Array<{ id: string; severity: string; summary: string }>;
    publishedBy?: string | null;
  }) {
    if (!SEMVER.test(input.version)) throw new BadRequestException("Version must be semantic versioning");
    if (input.items.length === 0) throw new BadRequestException("A package version must contain at least one artifact");
    if (new Set(input.items.map((item) => item.exportName)).size !== input.items.length) {
      throw new BadRequestException("Package export names must be unique");
    }

    const pkg = await this.db.devPackage.findFirst({
      where: { tenantId: input.tenantId, id: input.packageId, status: "ACTIVE" },
    });
    if (!pkg) throw new NotFoundException("Package not found");

    const resolved = [] as any[];
    for (const requested of input.items) {
      const revision = await this.db.artifactRevision.findFirst({
        where: {
          tenantId: input.tenantId,
          artifactId: requested.artifactId,
          revision: requested.revision,
        },
        include: { artifact: true, dependencies: true },
      });
      if (!revision) throw new NotFoundException(`Artifact revision not found: ${requested.artifactId}@${requested.revision}`);
      if (revision.artifact.ownerProjectId !== null) {
        throw new BadRequestException(`Artifact ${requested.artifactId} is project-owned and cannot enter a Library package`);
      }
      const manifest = builderManifestForKind(revision.artifact.artifactType as CanonicalArtifactKind);
      if (!manifest?.portability.packageEligible) {
        throw new BadRequestException(`Artifact kind ${revision.artifact.artifactType} is not package eligible`);
      }
      if (revision.validationStatus !== "VALID") {
        throw new BadRequestException(`Artifact ${requested.artifactId}@${requested.revision} is not valid`);
      }
      resolved.push({ requested, revision, manifest });
    }

    const packageManifest = {
      apiVersion: "unierp.package/v1",
      package: { id: pkg.id, namespace: pkg.namespace, name: pkg.name, editability: pkg.editability },
      version: input.version,
      items: resolved
        .map(({ requested, revision }) => ({
          exportName: requested.exportName,
          artifactId: requested.artifactId,
          revision: requested.revision,
          kind: revision.artifact.artifactType,
          contentHash: revision.contentHash,
        }))
        .sort((a, b) => a.exportName.localeCompare(b.exportName)),
      dependencies: resolved
        .flatMap(({ revision }) => revision.dependencies)
        .map((dep: any) => ({
          alias: dep.alias,
          kind: dep.targetKind,
          target: dep.targetCoordinate,
          versionRange: dep.versionRange,
          optional: dep.optional,
        }))
        .sort((a, b) => `${a.target}:${a.alias}`.localeCompare(`${b.target}:${b.alias}`)),
      capabilities: Array.from(
        new Set(
          resolved.flatMap(({ revision }) =>
            Array.isArray(revision.source?.capabilities)
              ? revision.source.capabilities.map((capability: any) => canonical(capability))
              : [],
          ),
        ),
      ).map((entry) => JSON.parse(String(entry))),
      security: {
        licenseExpression: input.licenseExpression ?? null,
        sbomDigest: input.sbomDigest ?? null,
        vulnerabilityStatus: input.vulnerabilityStatus ?? "UNKNOWN",
        vulnerabilityReport: input.vulnerabilityReport ?? [],
      },
    };
    const contentHash = digest(packageManifest);

    return this.db.$transaction(async (tx: any) => {
      const existing = await tx.devPackageVersion.findFirst({
        where: { packageId: input.packageId, version: input.version },
      });
      if (existing) throw new ConflictException("Package version already exists and is immutable");

      return tx.devPackageVersion.create({
        data: {
          tenantId: input.tenantId,
          packageId: input.packageId,
          version: input.version,
          manifest: packageManifest,
          contentHash,
          requiredCapabilities: packageManifest.capabilities,
          compatibility: { platformContract: "^1.0.0", builders: resolved.map(({ manifest }) => ({ id: manifest.id, version: manifest.version })) },
          licenseExpression: input.licenseExpression ?? null,
          sbomDigest: input.sbomDigest ?? null,
          vulnerabilityStatus: input.vulnerabilityStatus ?? "UNKNOWN",
          vulnerabilityReport: input.vulnerabilityReport ?? [],
          status: "DRAFT",
          publishedBy: input.publishedBy ?? null,
          items: {
            create: resolved.map(({ requested, revision }) => ({
              tenantId: input.tenantId,
              artifactId: requested.artifactId,
              revisionId: revision.id,
              exportName: requested.exportName,
            })),
          },
        },
        include: { items: true },
      });
    });
  }

  async install(input: {
    tenantId: string;
    projectId: string;
    packageVersionId: string;
    mode: InstallationMode;
    requestedRange?: string | null;
    resourceMappings?: Record<string, unknown>;
    capabilityGrants?: unknown[];
    installedBy?: string | null;
  }) {
    const [project, version] = await Promise.all([
      this.db.devProject.findFirst({ where: { tenantId: input.tenantId, id: input.projectId } }),
      this.db.devPackageVersion.findFirst({
        where: { tenantId: input.tenantId, id: input.packageVersionId },
        include: { package: true, items: { include: { artifact: true } } },
      }),
    ]);
    if (!project) throw new NotFoundException("Project not found");
    if (!version) throw new NotFoundException("Package version not found");
    if (version.package.status !== "ACTIVE" || version.status !== "PUBLISHED" || !version.signature) {
      throw new BadRequestException("Only signed, published package versions can be installed");
    }

    const requiredDependencies = Array.isArray(version.manifest?.dependencies)
      ? version.manifest.dependencies.filter((dependency: any) => !dependency.optional)
      : [];
    const mappings = input.resourceMappings ?? {};
    const missingMappings = requiredDependencies
      .filter((dependency: any) => !Object.prototype.hasOwnProperty.call(mappings, dependency.alias))
      .map((dependency: any) => dependency.alias);
    if (missingMappings.length > 0) {
      throw new BadRequestException(`Missing required resource mappings: ${missingMappings.join(", ")}`);
    }
    const granted = new Set((input.capabilityGrants ?? []).map(canonical));
    const requiredCapabilities = Array.isArray(version.requiredCapabilities)
      ? version.requiredCapabilities
      : [];
    const missingCapabilities = requiredCapabilities.filter(
      (capability: unknown) => !granted.has(canonical(capability)),
    );
    if (missingCapabilities.length > 0) {
      throw new BadRequestException({
        message: "Required package capabilities were not explicitly granted",
        missingCapabilities,
      });
    }

    for (const item of version.items) {
      const manifest = builderManifestForKind(item.artifact.artifactType as CanonicalArtifactKind);
      if (!manifest?.portability.consumerProjectKinds.includes(project.kind)) {
        throw new BadRequestException(`${item.artifact.artifactType} is not compatible with ${project.kind} projects`);
      }
      if (!manifest.portability.installationModes.includes(input.mode)) {
        throw new BadRequestException(`${input.mode} is not allowed for ${item.artifact.artifactType}`);
      }
    }

    const lock = {
      apiVersion: "unierp.lock/v1",
      packageId: version.packageId,
      packageVersionId: version.id,
      version: version.version,
      contentHash: version.contentHash,
      resolvedAt: new Date().toISOString(),
    };
    return this.db.$transaction(async (tx: any) => {
      const installation = await tx.projectInstallation.create({
        data: {
          tenantId: input.tenantId,
          projectId: input.projectId,
          packageId: version.packageId,
          packageVersionId: version.id,
          mode: input.mode,
          requestedRange: input.requestedRange ?? null,
          lock,
          resourceMappings: input.resourceMappings ?? {},
          capabilityGrants: input.capabilityGrants ?? [],
          installedBy: input.installedBy ?? null,
        },
      });
      for (const item of version.items) {
        await tx.builderArtifactAttachment.upsert({
          where: { artifactId_projectId: { artifactId: item.artifactId, projectId: input.projectId } },
          create: {
            tenantId: input.tenantId,
            artifactId: item.artifactId,
            projectId: input.projectId,
            isOwner: false,
            attachedBy: input.installedBy ?? null,
          },
          update: { detachedAt: null, attachedBy: input.installedBy ?? null },
        });
      }
      return installation;
    });
  }

  async upgradeImpact(input: {
    tenantId: string;
    projectId: string;
    installationId: string;
    targetPackageVersionId: string;
  }) {
    const installation = await this.db.projectInstallation.findFirst({
      where: { tenantId: input.tenantId, projectId: input.projectId, id: input.installationId, removedAt: null },
      include: { packageVersion: { include: { items: { include: { artifact: true, revision: true } } } } },
    });
    if (!installation) throw new NotFoundException("Installation not found");
    const target = await this.db.devPackageVersion.findFirst({
      where: { tenantId: input.tenantId, id: input.targetPackageVersionId, packageId: installation.packageId },
      include: { items: { include: { artifact: true, revision: true } } },
    });
    if (!target) throw new NotFoundException("Target package version not found");
    if (target.status !== "PUBLISHED" || !target.signature) {
      throw new BadRequestException("Upgrade target must be signed and published");
    }
    const currentItems = new Map(
      installation.packageVersion.items.map((item: any) => [item.exportName, item]),
    );
    const targetItems = new Map(target.items.map((item: any) => [item.exportName, item]));
    const added = [...targetItems.keys()].filter((name) => !currentItems.has(name));
    const removed = [...currentItems.keys()].filter((name) => !targetItems.has(name));
    const changed = [...targetItems.entries()]
      .filter(([name, item]: any) => {
        const current: any = currentItems.get(name);
        return current && current.revision.contentHash !== item.revision.contentHash;
      })
      .map(([name]: any) => name);
    return {
      installationId: installation.id,
      from: { id: installation.packageVersion.id, version: installation.packageVersion.version, contentHash: installation.packageVersion.contentHash },
      to: { id: target.id, version: target.version, contentHash: target.contentHash },
      changes: { added, removed, changed },
      breaking: removed.length > 0,
      requiresApproval: removed.length > 0 || changed.length > 0,
    };
  }

  async upgrade(input: {
    tenantId: string;
    projectId: string;
    installationId: string;
    targetPackageVersionId: string;
    approvedBreaking: boolean;
  }) {
    const impact = await this.upgradeImpact(input);
    if (impact.breaking && !input.approvedBreaking) {
      throw new ConflictException({ message: "Upgrade contains breaking removals", impact });
    }
    return this.db.projectInstallation.update({
      where: { id: input.installationId },
      data: {
        packageVersionId: impact.to.id,
        lock: {
          apiVersion: "unierp.lock/v1",
          packageId: (await this.db.projectInstallation.findFirst({ where: { id: input.installationId } })).packageId,
          packageVersionId: impact.to.id,
          version: impact.to.version,
          contentHash: impact.to.contentHash,
          resolvedAt: new Date().toISOString(),
        },
      },
    });
  }

  async remove(tenantId: string, projectId: string, installationId: string) {
    const row = await this.db.projectInstallation.findFirst({
      where: { tenantId, projectId, id: installationId, removedAt: null },
      include: { packageVersion: { include: { items: true } } },
    });
    if (!row) throw new NotFoundException("Installation not found");
    const artifactIds = row.packageVersion.items.map((item: any) => item.artifactId);
    const [dependencies, remaining] = await Promise.all([
      this.db.artifactDependency.findMany({
        where: { tenantId, targetArtifactId: { in: artifactIds } },
        include: { sourceRevision: { include: { artifact: true } } },
      }),
      this.db.projectInstallation.findMany({
        where: { tenantId, projectId, removedAt: null, id: { not: row.id } },
        include: { packageVersion: { include: { items: true } } },
      }),
    ]);
    const providers = new Set(remaining.flatMap((installation: any) => installation.packageVersion.items.map((item: any) => item.artifactId)));
    const blockers = dependencies.filter((dependency: any) => {
      const owner = dependency.sourceRevision.artifact.ownerProjectId;
      return owner === projectId || providers.has(dependency.sourceRevision.artifactId);
    });
    if (blockers.length) {
      throw new ConflictException({
        message: "Package removal would orphan required project dependencies",
        blockers: blockers.map((dependency: any) => ({ alias: dependency.alias, sourceArtifactId: dependency.sourceRevision.artifactId, targetArtifactId: dependency.targetArtifactId })),
      });
    }
    return this.db.$transaction(async (tx: any) => {
      const removed = await tx.projectInstallation.update({ where: { id: row.id }, data: { status: "REMOVED", removedAt: new Date() } });
      for (const artifactId of artifactIds.filter((id: string) => !providers.has(id))) {
        await tx.builderArtifactAttachment.updateMany({ where: { tenantId, projectId, artifactId, isOwner: false, detachedAt: null }, data: { detachedAt: new Date() } });
      }
      return removed;
    });
  }

  async certifyVersion(input: { tenantId: string; packageId: string; packageVersionId: string; certifiedBy?: string | null }) {
    const version = await this.db.devPackageVersion.findFirst({
      where: { tenantId: input.tenantId, id: input.packageVersionId, packageId: input.packageId, status: "PUBLISHED" },
      include: { package: true, items: { include: { artifact: true, revision: true } } },
    });
    if (!version || !version.signature) throw new NotFoundException("Signed published package version not found");
    const checks = version.items.map((item: any) => {
      const manifest = builderManifestForKind(item.artifact.artifactType as CanonicalArtifactKind);
      const valid = Boolean(manifest && manifest.status !== "PLANNED" && item.revision.validationStatus === "VALID");
      return { id: `builder:${item.exportName}`, status: valid ? "PASS" : "FAIL", message: valid ? `${item.artifact.artifactType} is deployable` : `${item.artifact.artifactType} lacks a deployable validated builder` };
    });
    checks.push({ id: "signature", status: version.signature ? "PASS" : "FAIL", message: version.signature ? "Package provenance is signed" : "Package provenance is missing" });
    const licenseValid = typeof version.licenseExpression === "string" && /^[A-Za-z0-9.+-]+(?:\s+(?:AND|OR|WITH)\s+[A-Za-z0-9.+-]+)*$/.test(version.licenseExpression);
    const sbomValid = typeof version.sbomDigest === "string" && /^[a-f0-9]{64}$/i.test(version.sbomDigest);
    const vulnerabilitiesClean = version.vulnerabilityStatus === "CLEAN";
    checks.push({ id: "license", status: licenseValid ? "PASS" : "FAIL", message: licenseValid ? "Package license expression is declared" : "Package requires a valid license expression" });
    checks.push({ id: "sbom", status: sbomValid ? "PASS" : "FAIL", message: sbomValid ? "Package SBOM digest is immutable" : "Package requires a SHA-256 SBOM digest" });
    checks.push({ id: "vulnerabilities", status: vulnerabilitiesClean ? "PASS" : "FAIL", message: vulnerabilitiesClean ? "No blocking vulnerabilities are declared" : "Package vulnerability disposition is not CLEAN" });
    const passed = checks.every((check) => check.status === "PASS");
    return this.db.packageCertification.create({ data: { tenantId: input.tenantId, packageVersionId: version.id, status: passed ? "PASSED" : "FAILED", report: checks, certifiedBy: input.certifiedBy ?? null, certifiedAt: new Date() } });
  }

  async promoteToMarketplace(input: { tenantId: string; packageId: string; packageVersionId: string }) {
    const certification = await this.db.packageCertification.findFirst({ where: { tenantId: input.tenantId, packageVersionId: input.packageVersionId, status: "PASSED" }, orderBy: { certifiedAt: "desc" } });
    if (!certification) throw new ConflictException("A passing package certification is required for marketplace promotion");
    const version = await this.db.devPackageVersion.findFirst({ where: { tenantId: input.tenantId, id: input.packageVersionId, packageId: input.packageId, status: "PUBLISHED" } });
    if (!version) throw new NotFoundException("Published package version not found");
    return this.db.devPackage.update({ where: { id: input.packageId }, data: { visibility: "MARKETPLACE" } });
  }

  /** Emergency control-plane kill switch. Historical manifests remain immutable,
   * but runtime resolution consults this state before serving a package. */
  async suspendPackage(tenantId: string, packageId: string) {
    const pkg = await this.db.devPackage.findFirst({ where: { tenantId, id: packageId, status: { not: "DELETED" } } });
    if (!pkg) throw new NotFoundException("Package not found");
    const suspended = await this.db.devPackage.update({ where: { id: packageId }, data: { status: "SUSPENDED", visibility: "PRIVATE" } });
    await this.invalidateRuntimePlans(tenantId);
    return suspended;
  }

  async reinstatePackage(tenantId: string, packageId: string) {
    const pkg = await this.db.devPackage.findFirst({ where: { tenantId, id: packageId, status: "SUSPENDED" } });
    if (!pkg) throw new NotFoundException("Suspended package not found");
    return this.db.devPackage.update({ where: { id: packageId }, data: { status: "ACTIVE" } });
  }

  async publishVersion(input: {
    tenantId: string;
    packageId: string;
    packageVersionId: string;
    keyId: string;
    signature: string;
    publishedBy?: string | null;
  }) {
    const [version, key] = await Promise.all([
      this.db.devPackageVersion.findFirst({
        where: {
          tenantId: input.tenantId,
          id: input.packageVersionId,
          packageId: input.packageId,
        },
      }),
      this.db.devSigningKey.findFirst({
        where: { tenantId: input.tenantId, keyId: input.keyId, status: "ACTIVE", revokedAt: null },
      }),
    ]);
    if (!version) throw new NotFoundException("Package version not found");
    if (!key) throw new NotFoundException("Active signing key not found");
    if (version.status !== "DRAFT") throw new ConflictException("Only a draft package version can be published");

    let valid = false;
    try {
      valid = verify(
        null,
        Buffer.from(version.contentHash, "utf8"),
        createPublicKey({ key: Buffer.from(key.publicKey, "base64"), format: "der", type: "spki" }),
        Buffer.from(input.signature, "base64"),
      );
    } catch {
      valid = false;
    }
    if (!valid) throw new BadRequestException("Package signature is invalid");

    const signatureEnvelope = canonical({
      algorithm: "Ed25519",
      keyId: input.keyId,
      signature: input.signature,
      signedContentHash: version.contentHash,
    });
    return this.db.devPackageVersion.update({
      where: { id: version.id },
      data: {
        signature: signatureEnvelope,
        status: "PUBLISHED",
        publishedBy: input.publishedBy ?? null,
        publishedAt: new Date(),
      },
    });
  }
}
