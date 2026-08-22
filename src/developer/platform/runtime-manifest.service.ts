import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { prisma } from "@kannan19302/database";
import { assertReleaseManifestV1, type ReleaseManifestV1 } from "@kannan19302/contracts";
import { createPublicKey, verify } from "node:crypto";
import { releaseDigest } from "./project-releases.service";
import { RuntimeCellRouterService } from "./runtime-cell-router.service";
import { RuntimeCellAssignmentService } from "./runtime-cell-assignment.service";
import { RuntimePlanCacheService } from "./runtime-plan-cache.service";
import { PreviewSubmissionsService } from "./preview-submissions.service";

/**
 * The runtime never resolves a mutable editor draft. It consumes one active,
 * signed manifest and verified non-secret binding references, giving every
 * builder the same immutable runtime input regardless of its own renderer.
 */
@Injectable()
export class RuntimeManifestService {
  private readonly db = prisma as any;
  constructor(private readonly cells: RuntimeCellRouterService = new RuntimeCellRouterService(), private readonly assignments?: RuntimeCellAssignmentService, private readonly cache: RuntimePlanCacheService = new RuntimePlanCacheService(), private readonly submissions?: PreviewSubmissionsService) {}

  async resolve(input: { tenantId: string; projectId: string; environmentId: string }) {
    const key = `${input.tenantId}:${input.projectId}:${input.environmentId}`;
    try {
      const plan = await this.resolveFresh(input);
      this.cache.set(key, plan);
      return plan;
    } catch (error) {
      // Explicit validation/policy failures must fail closed. A short-lived
      // verified cache only bridges a control-plane availability failure.
      if (error instanceof ConflictException || error instanceof NotFoundException) throw error;
      const cached = this.cache.get(key);
      if (cached) return cached;
      throw error;
    }
  }

  async submit(input: { tenantId: string; projectId: string; environmentId: string; formArtifactId: string; values: Record<string, unknown>; createdBy?: string | null }) {
    if (!this.submissions) throw new ConflictException("Runtime submission adapter is unavailable");
    const plan = await this.resolve(input);
    return this.submissions.submit({ tenantId: input.tenantId, projectId: input.projectId, runtime: { releaseId: plan.releaseId, environmentId: input.environmentId }, formArtifactId: input.formArtifactId, values: input.values, createdBy: input.createdBy, artifacts: plan.artifacts });
  }

  private async resolveFresh(input: { tenantId: string; projectId: string; environmentId: string }): Promise<any> {
    const environment = await this.db.environment.findFirst({ where: { tenantId: input.tenantId, id: input.environmentId, status: "ACTIVE" } });
    if (!environment) throw new NotFoundException("Active environment not found");
    const active = (environment.metadata as any)?.activeDeveloperRelease;
    if (!active || active.projectId !== input.projectId || !active.releaseId) throw new NotFoundException("No active developer release for this project in the environment");
    const release = await this.db.projectRelease.findFirst({ where: { tenantId: input.tenantId, projectId: input.projectId, id: active.releaseId, status: "PUBLISHED" } });
    if (!release) throw new NotFoundException("Active published release not found");
    const manifest = release.snapshot as ReleaseManifestV1;
    assertReleaseManifestV1(manifest);
    if (active.manifestHash !== release.manifestHash) throw new ConflictException("Environment activation does not match the release manifest");
    await this.assertSignature(input.tenantId, release, manifest);
    await this.assertPackagesActive(input.tenantId, manifest);
    const artifacts = await this.hydrateArtifacts(input.tenantId, manifest);
    const bindings = await this.db.environmentBinding.findMany({ where: { tenantId: input.tenantId, projectId: input.projectId, environmentId: input.environmentId, status: "VERIFIED" } });
    const byKey = new Map(bindings.map((binding: any) => [binding.key, binding]));
    const resolvedBindings = manifest.requiredBindings.map((required) => {
      const binding = byKey.get(required.key) as any;
      if (!binding) throw new ConflictException(`Required environment binding is absent or unverified: ${required.key}`);
      return { key: required.key, kind: binding.kind, reference: binding.reference, requiredCapabilities: required.requiredCapabilities };
    });
    return Object.freeze({
      apiVersion: "unierp.runtime-plan/v1",
      tenantId: input.tenantId,
      environmentId: input.environmentId,
      projectId: input.projectId,
      releaseId: release.id,
      manifestHash: release.manifestHash,
      placement: this.assignments ? await this.assignments.placement(input.tenantId) : this.cells.place(input.tenantId),
      packages: manifest.packages,
      artifacts,
      bindings: resolvedBindings,
      provenance: { toolchain: manifest.provenance.toolchain, sbomDigest: manifest.provenance.sbomDigest },
    });
  }

  private async hydrateArtifacts(tenantId: string, manifest: ReleaseManifestV1) {
    if (!manifest.artifacts.length) return [];
    const ids = manifest.artifacts.map((artifact) => artifact.artifactId);
    const revisions = [...new Set(manifest.artifacts.map((artifact) => artifact.revision))];
    const rows = await this.db.builderArtifact.findMany({ where: { tenantId, id: { in: ids }, deletedAt: null }, include: { revisions: { where: { revision: { in: revisions } } } } });
    const byIdentity = new Map<string, any>();
    for (const artifact of rows) for (const revision of artifact.revisions ?? []) byIdentity.set(`${artifact.id}:${revision.revision}`, { artifact, revision });
    return manifest.artifacts.map((pinned) => {
      const resolved = byIdentity.get(`${pinned.artifactId}:${pinned.revision}`);
      if (!resolved) throw new ConflictException(`Pinned artifact revision is unavailable: ${pinned.artifactId}@${pinned.revision}`);
      if (resolved.revision.contentHash !== pinned.sourceHash) throw new ConflictException(`Pinned artifact source hash is invalid: ${pinned.artifactId}`);
      const compiledHash = releaseDigest({ compiler: manifest.provenance.toolchain, sourceHash: pinned.sourceHash, source: resolved.revision.source });
      if (compiledHash !== pinned.compiledHash) throw new ConflictException(`Pinned artifact compiled hash is invalid: ${pinned.artifactId}`);
      return { ...pinned, kind: resolved.artifact.artifactType, source: resolved.revision.source };
    });
  }

  private async assertSignature(tenantId: string, release: any, manifest: ReleaseManifestV1) {
    if (!release.manifestHash || !release.signature || !release.signingKeyId) throw new ConflictException("Release is missing signed provenance");
    const { signature, ...provenance } = manifest.provenance;
    const unsigned = { ...manifest, provenance };
    if (releaseDigest(unsigned) !== release.manifestHash) throw new ConflictException("Release manifest hash does not match its immutable content");
    const key = await this.db.devSigningKey.findFirst({ where: { tenantId, keyId: release.signingKeyId, status: "ACTIVE", revokedAt: null } });
    if (!key) throw new ConflictException("Release signing key is unavailable or revoked");
    let valid = false;
    try { valid = verify(null, Buffer.from(release.manifestHash, "utf8"), createPublicKey({ key: Buffer.from(key.publicKey, "base64"), format: "der", type: "spki" }), Buffer.from(release.signature, "base64")); } catch { valid = false; }
    if (!valid || signature !== release.signature) throw new ConflictException("Release signature verification failed");
  }

  private async assertPackagesActive(tenantId: string, manifest: ReleaseManifestV1) {
    const packageIds = [...new Set(manifest.packages.map((item) => item.packageId))];
    if (packageIds.length === 0) return;
    const active = await this.db.devPackage.findMany({ where: { tenantId, id: { in: packageIds }, status: "ACTIVE" }, select: { id: true } });
    const activeIds = new Set(active.map((pkg: any) => pkg.id));
    const unavailable = packageIds.filter((id) => !activeIds.has(id));
    if (unavailable.length) throw new ConflictException(`Release references suspended or unavailable package(s): ${unavailable.join(", ")}`);
  }
}
