import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { createHash } from "node:crypto";
import { prisma } from "@kannan19302/database";
import {
  assertArtifactEnvelopeV1,
  type ArtifactEnvelopeV1,
} from "@kannan19302/contracts";
import { isUniqueViolation } from "./prisma-errors";

export type ArtifactScope =
  | { kind: "PROJECT"; projectId: string }
  | { kind: "LIBRARY" };

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  }
  return value;
}

export function canonicalArtifactJson(source: ArtifactEnvelopeV1): string {
  return JSON.stringify(canonicalize(source));
}

export function artifactContentHash(source: ArtifactEnvelopeV1): string {
  return createHash("sha256").update(canonicalArtifactJson(source)).digest("hex");
}

/**
 * The scope-aware write boundary for canonical artifact source. It is kept
 * separate from ArtifactRegistryService so stable identity/discovery and
 * immutable source history cannot accidentally share CRUD semantics.
 */
@Injectable()
export class ArtifactRevisionsService {
  private readonly db = prisma as any;

  async list(tenantId: string, artifactId: string, scope: ArtifactScope) {
    await this.assertArtifactInScope(tenantId, artifactId, scope);
    return this.db.artifactRevision.findMany({
      where: { tenantId, artifactId },
      orderBy: { revision: "desc" },
      select: {
        id: true,
        revision: true,
        parentRevisionId: true,
        apiVersion: true,
        schemaVersion: true,
        contentHash: true,
        validationStatus: true,
        validationResult: true,
        createdBy: true,
        createdAt: true,
      },
    });
  }

  async get(tenantId: string, artifactId: string, revision: number, scope: ArtifactScope) {
    await this.assertArtifactInScope(tenantId, artifactId, scope);
    const row = await this.db.artifactRevision.findFirst({
      where: { tenantId, artifactId, revision },
      include: { dependencies: true },
    });
    if (!row) throw new NotFoundException("Artifact revision not found");
    return row;
  }

  async create(input: {
    tenantId: string;
    artifactId: string;
    scope: ArtifactScope;
    expectedRevision: number;
    source: unknown;
    createdBy?: string | null;
  }) {
    let source: ArtifactEnvelopeV1;
    try {
      assertArtifactEnvelopeV1(input.source);
      source = input.source;
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : "Invalid artifact envelope",
      );
    }

    const artifact = await this.assertArtifactInScope(
      input.tenantId,
      input.artifactId,
      input.scope,
    );
    if (source.metadata.id !== artifact.id) {
      throw new BadRequestException("metadata.id must match the stable artifact id");
    }
    if (source.kind !== artifact.artifactType) {
      throw new BadRequestException("Artifact kind does not match the registry identity");
    }

    const contentHash = artifactContentHash(source);
    const dependencies = source.dependencies.map((dependency) => ({
      tenantId: input.tenantId,
      alias: dependency.alias,
      targetKind: dependency.kind,
      targetCoordinate: dependency.target,
      versionRange: dependency.versionRange,
      optional: dependency.optional ?? false,
    }));

    return this.db.$transaction(async (tx: any) => {
      const latest = await tx.artifactRevision.findFirst({
        where: { tenantId: input.tenantId, artifactId: input.artifactId },
        orderBy: { revision: "desc" },
      });
      const currentRevision = latest?.revision ?? 0;
      if (currentRevision !== input.expectedRevision) {
        throw new ConflictException({
          message: "Artifact revision conflict",
          expectedRevision: input.expectedRevision,
          currentRevision,
          currentHash: latest?.contentHash ?? null,
        });
      }
      if (latest?.contentHash === contentHash) return latest;

      return tx.artifactRevision.create({
        data: {
          tenantId: input.tenantId,
          artifactId: input.artifactId,
          revision: currentRevision + 1,
          parentRevisionId: latest?.id ?? null,
          apiVersion: source.apiVersion,
          schemaVersion: 1,
          source,
          contentHash,
          validationStatus: "VALID",
          validationResult: { issues: [] },
          createdBy: input.createdBy ?? null,
          dependencies: { create: dependencies },
        },
        include: { dependencies: true },
      });
    });
  }

  /**
   * Migration adapter for a legacy projection that has no client-side ETag.
   * It writes the exact same immutable envelope/revision model as normal
   * authoring, but de-duplicates the current content hash.  Callers must
   * already have written the concrete projection; this adapter never makes a
   * projection the source of truth for a signed release.
   */
  async syncLegacyProjection(input: {
    tenantId: string; artifactId: string; scope: ArtifactScope; source: unknown; createdBy?: string | null;
  }) {
    let source: ArtifactEnvelopeV1;
    try { assertArtifactEnvelopeV1(input.source); source = input.source; }
    catch (error) { throw new BadRequestException(error instanceof Error ? error.message : "Invalid artifact envelope"); }
    const artifact = await this.assertArtifactInScope(input.tenantId, input.artifactId, input.scope);
    if (source.metadata.id !== artifact.id || source.kind !== artifact.artifactType) throw new BadRequestException("Artifact identity mismatch for legacy projection");
    const contentHash = artifactContentHash(source);
    const dependencies = source.dependencies.map((dependency) => ({ tenantId: input.tenantId, alias: dependency.alias, targetKind: dependency.kind, targetCoordinate: dependency.target, versionRange: dependency.versionRange, optional: dependency.optional ?? false }));
    // Legacy endpoints lack an ETag. A competing projection write can win the
    // `(artifact_id, revision)` unique index between our read and insert; one
    // retry re-reads it and either observes the same content or appends after
    // the winner without silently losing either immutable revision.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await this.db.$transaction(async (tx: any) => {
          const latest = await tx.artifactRevision.findFirst({ where: { tenantId: input.tenantId, artifactId: artifact.id }, orderBy: { revision: "desc" } });
          if (latest?.contentHash === contentHash) return latest;
          return tx.artifactRevision.create({ data: { tenantId: input.tenantId, artifactId: artifact.id, revision: (latest?.revision ?? 0) + 1, parentRevisionId: latest?.id ?? null, apiVersion: source.apiVersion, schemaVersion: 1, source, contentHash, validationStatus: "VALID", validationResult: { issues: [] }, createdBy: input.createdBy ?? null, dependencies: { create: dependencies } }, include: { dependencies: true } });
        });
      } catch (error) {
        if (attempt === 0 && isUniqueViolation(error)) continue;
        throw error;
      }
    }
    throw new ConflictException("Legacy projection revision could not converge");
  }

  /** Atomically applies several already-validated source edits. Used by the
   * pro-code import boundary so a conflict on one artifact cannot leave a
   * half-imported project. New identities and deletes remain explicit flows. */
  async createBatch(input: {
    tenantId: string; scope: ArtifactScope; createdBy?: string | null;
    changes: Array<{ artifactId: string; expectedRevision: number; source: unknown }>;
  }) {
    if (!input.changes.length) return [];
    if (new Set(input.changes.map((change) => change.artifactId)).size !== input.changes.length) throw new BadRequestException("An import batch cannot update an artifact more than once");
    const prepared = [] as Array<{ artifact: any; artifactId: string; expectedRevision: number; source: ArtifactEnvelopeV1; contentHash: string; dependencies: any[] }>;
    for (const change of input.changes) {
      let source: ArtifactEnvelopeV1;
      try { assertArtifactEnvelopeV1(change.source); source = change.source; } catch (error) { throw new BadRequestException(error instanceof Error ? error.message : "Invalid artifact envelope"); }
      const artifact = await this.assertArtifactInScope(input.tenantId, change.artifactId, input.scope);
      if (source.metadata.id !== artifact.id || source.kind !== artifact.artifactType) throw new BadRequestException(`Artifact identity mismatch for ${change.artifactId}`);
      prepared.push({ artifact, artifactId: change.artifactId, expectedRevision: change.expectedRevision, source, contentHash: artifactContentHash(source), dependencies: source.dependencies.map((dependency) => ({ tenantId: input.tenantId, alias: dependency.alias, targetKind: dependency.kind, targetCoordinate: dependency.target, versionRange: dependency.versionRange, optional: dependency.optional ?? false })) });
    }
    return this.db.$transaction(async (tx: any) => {
      const results: any[] = [];
      for (const change of [...prepared].sort((a, b) => a.artifactId.localeCompare(b.artifactId))) {
        const latest = await tx.artifactRevision.findFirst({ where: { tenantId: input.tenantId, artifactId: change.artifactId }, orderBy: { revision: "desc" } });
        const currentRevision = latest?.revision ?? 0;
        if (currentRevision !== change.expectedRevision) throw new ConflictException({ message: "Artifact revision conflict", artifactId: change.artifactId, expectedRevision: change.expectedRevision, currentRevision, currentHash: latest?.contentHash ?? null });
        if (latest?.contentHash === change.contentHash) { results.push(latest); continue; }
        results.push(await tx.artifactRevision.create({ data: { tenantId: input.tenantId, artifactId: change.artifactId, revision: currentRevision + 1, parentRevisionId: latest?.id ?? null, apiVersion: change.source.apiVersion, schemaVersion: 1, source: change.source, contentHash: change.contentHash, validationStatus: "VALID", validationResult: { issues: [] }, createdBy: input.createdBy ?? null, dependencies: { create: change.dependencies } }, include: { dependencies: true } }));
      }
      return results;
    });
  }

  /**
   * Creates canonical project-owned identities directly from a verified source
   * bundle. Legacy concrete tables are projections, not a prerequisite for a
   * source-authored artifact; the registry plus immutable first revision is
   * the authoritative write. All identities are committed together.
   */
  async createImportedProjectArtifacts(input: {
    tenantId: string; projectId: string; createdBy?: string | null;
    artifacts: Array<{ id: string; kind: string; source: unknown }>;
  }) {
    if (!input.artifacts.length) return [];
    if (new Set(input.artifacts.map((artifact) => artifact.id)).size !== input.artifacts.length) throw new BadRequestException("An import cannot create the same artifact identity twice");
    const prepared = input.artifacts.map((artifact) => {
      let source: ArtifactEnvelopeV1;
      try { assertArtifactEnvelopeV1(artifact.source); source = artifact.source; } catch (error) { throw new BadRequestException(error instanceof Error ? error.message : "Invalid artifact envelope"); }
      if (source.metadata.id !== artifact.id || source.kind !== artifact.kind) throw new BadRequestException(`Artifact identity mismatch for ${artifact.id}`);
      return { ...artifact, source, contentHash: artifactContentHash(source), dependencies: source.dependencies.map((dependency) => ({ tenantId: input.tenantId, alias: dependency.alias, targetKind: dependency.kind, targetCoordinate: dependency.target, versionRange: dependency.versionRange, optional: dependency.optional ?? false })) };
    });
    return this.db.$transaction(async (tx: any) => {
      const project = await tx.devProject.findFirst({ where: { tenantId: input.tenantId, id: input.projectId } });
      if (!project) throw new NotFoundException("Project not found");
      const created: any[] = [];
      for (const artifact of [...prepared].sort((a, b) => a.id.localeCompare(b.id))) {
        const existing = await tx.builderArtifact.findFirst({ where: { tenantId: input.tenantId, id: artifact.id } });
        if (existing) throw new ConflictException(`Artifact identity ${artifact.id} already exists`);
        const row = await tx.builderArtifact.create({ data: { id: artifact.id, tenantId: input.tenantId, artifactType: artifact.kind, artifactId: artifact.id, ownerProjectId: input.projectId, name: artifact.source.metadata.name, status: "DRAFT", createdBy: input.createdBy ?? null } });
        await tx.builderArtifactAttachment.create({ data: { tenantId: input.tenantId, artifactId: row.id, projectId: input.projectId, isOwner: true, attachedBy: input.createdBy ?? null } });
        created.push(await tx.artifactRevision.create({ data: { tenantId: input.tenantId, artifactId: row.id, revision: 1, apiVersion: artifact.source.apiVersion, schemaVersion: 1, source: artifact.source, contentHash: artifact.contentHash, validationStatus: "VALID", validationResult: { issues: [] }, createdBy: input.createdBy ?? null, dependencies: { create: artifact.dependencies } }, include: { dependencies: true } }));
      }
      return created;
    });
  }

  /** Soft-delete project-owned canonical artifacts only after proving no live
   * artifact or package still depends on them. Historical revisions remain
   * intact for signed-release and audit retention. */
  async softDeleteImportedProjectArtifacts(input: { tenantId: string; projectId: string; artifactIds: string[] }) {
    if (!input.artifactIds.length) return { deleted: [] as string[] };
    const ids = [...new Set(input.artifactIds)].sort();
    return this.db.$transaction(async (tx: any) => {
      const artifacts = await tx.builderArtifact.findMany({ where: { tenantId: input.tenantId, id: { in: ids }, ownerProjectId: input.projectId, deletedAt: null } });
      if (artifacts.length !== ids.length) throw new NotFoundException("Only active project-owned artifacts can be removed through source import");
      const dependencies = await tx.artifactDependency.findMany({ where: { tenantId: input.tenantId, targetArtifactId: { in: ids } }, include: { sourceRevision: { include: { artifact: true } } } });
      const blockers = dependencies.filter((dependency: any) => !ids.includes(dependency.sourceRevision.artifactId) && !dependency.sourceRevision.artifact.deletedAt);
      if (blockers.length) throw new ConflictException({ message: "Source import removal would orphan live artifact dependencies", blockers: blockers.map((dependency: any) => ({ sourceArtifactId: dependency.sourceRevision.artifactId, targetArtifactId: dependency.targetArtifactId, alias: dependency.alias })) });
      const packageItems = await tx.devPackageItem.findMany({ where: { tenantId: input.tenantId, artifactId: { in: ids } } });
      if (packageItems.length) throw new ConflictException("Source import removal is blocked because an artifact belongs to a package version");
      const now = new Date();
      await tx.builderArtifact.updateMany({ where: { tenantId: input.tenantId, id: { in: ids }, ownerProjectId: input.projectId }, data: { deletedAt: now, status: "ARCHIVED" } });
      await tx.builderArtifactAttachment.updateMany({ where: { tenantId: input.tenantId, artifactId: { in: ids }, projectId: input.projectId, detachedAt: null }, data: { detachedAt: now } });
      return { deleted: ids };
    });
  }

  /** Atomic pro-code import for a create+update changeset. Imported updates
   * are limited to project-owned identities so a project bundle can never
   * silently mutate a Library export or installed package artifact. */
  async applyImportedProjectCreateAndUpdate(input: {
    tenantId: string; projectId: string; createdBy?: string | null;
    additions: Array<{ id: string; kind: string; source: unknown }>;
    updates: Array<{ artifactId: string; expectedRevision: number; source: unknown }>;
    removals?: string[];
    /** Internal, prevalidated project metadata mutation (for example package
     * lock reconciliation). It executes inside this exact transaction so a
     * dependency conflict cannot leave artifact source half-imported. */
    mutateProject?: (tx: any) => Promise<void>;
  }) {
    const additions = input.additions.map((artifact) => {
      let source: ArtifactEnvelopeV1;
      try { assertArtifactEnvelopeV1(artifact.source); source = artifact.source; } catch (error) { throw new BadRequestException(error instanceof Error ? error.message : "Invalid artifact envelope"); }
      if (source.metadata.id !== artifact.id || source.kind !== artifact.kind) throw new BadRequestException(`Artifact identity mismatch for ${artifact.id}`);
      return { ...artifact, source, contentHash: artifactContentHash(source), dependencies: source.dependencies.map((dependency) => ({ tenantId: input.tenantId, alias: dependency.alias, targetKind: dependency.kind, targetCoordinate: dependency.target, versionRange: dependency.versionRange, optional: dependency.optional ?? false })) };
    });
    const updates = input.updates.map((change) => {
      let source: ArtifactEnvelopeV1;
      try { assertArtifactEnvelopeV1(change.source); source = change.source; } catch (error) { throw new BadRequestException(error instanceof Error ? error.message : "Invalid artifact envelope"); }
      return { ...change, source, contentHash: artifactContentHash(source), dependencies: source.dependencies.map((dependency) => ({ tenantId: input.tenantId, alias: dependency.alias, targetKind: dependency.kind, targetCoordinate: dependency.target, versionRange: dependency.versionRange, optional: dependency.optional ?? false })) };
    });
    const removals = [...new Set(input.removals ?? [])].sort();
    if (new Set([...additions.map((item) => item.id), ...updates.map((item) => item.artifactId), ...removals]).size !== additions.length + updates.length + removals.length) throw new BadRequestException("An import cannot create, update, and remove the same artifact identity");
    return this.db.$transaction(async (tx: any) => {
      if (!await tx.devProject.findFirst({ where: { tenantId: input.tenantId, id: input.projectId } })) throw new NotFoundException("Project not found");
      const results: any[] = [];
      if (removals.length) {
        const artifacts = await tx.builderArtifact.findMany({ where: { tenantId: input.tenantId, id: { in: removals }, ownerProjectId: input.projectId, deletedAt: null } });
        if (artifacts.length !== removals.length) throw new NotFoundException("Only active project-owned artifacts can be removed through source import");
        const dependencies = await tx.artifactDependency.findMany({ where: { tenantId: input.tenantId, targetArtifactId: { in: removals } }, include: { sourceRevision: { include: { artifact: true } } } });
        const blockers = dependencies.filter((dependency: any) => !removals.includes(dependency.sourceRevision.artifactId) && !dependency.sourceRevision.artifact.deletedAt);
        if (blockers.length) throw new ConflictException({ message: "Source import removal would orphan live artifact dependencies", blockers: blockers.map((dependency: any) => ({ sourceArtifactId: dependency.sourceRevision.artifactId, targetArtifactId: dependency.targetArtifactId, alias: dependency.alias })) });
        if ((await tx.devPackageItem.findMany({ where: { tenantId: input.tenantId, artifactId: { in: removals } } })).length) throw new ConflictException("Source import removal is blocked because an artifact belongs to a package version");
      }
      await input.mutateProject?.(tx);
      for (const addition of [...additions].sort((a, b) => a.id.localeCompare(b.id))) {
        if (await tx.builderArtifact.findFirst({ where: { tenantId: input.tenantId, id: addition.id } })) throw new ConflictException(`Artifact identity ${addition.id} already exists`);
        const artifact = await tx.builderArtifact.create({ data: { id: addition.id, tenantId: input.tenantId, artifactType: addition.kind, artifactId: addition.id, ownerProjectId: input.projectId, name: addition.source.metadata.name, status: "DRAFT", createdBy: input.createdBy ?? null } });
        await tx.builderArtifactAttachment.create({ data: { tenantId: input.tenantId, artifactId: artifact.id, projectId: input.projectId, isOwner: true, attachedBy: input.createdBy ?? null } });
        results.push(await tx.artifactRevision.create({ data: { tenantId: input.tenantId, artifactId: artifact.id, revision: 1, apiVersion: addition.source.apiVersion, schemaVersion: 1, source: addition.source, contentHash: addition.contentHash, validationStatus: "VALID", validationResult: { issues: [] }, createdBy: input.createdBy ?? null, dependencies: { create: addition.dependencies } }, include: { dependencies: true } }));
      }
      for (const update of [...updates].sort((a, b) => a.artifactId.localeCompare(b.artifactId))) {
        const artifact = await tx.builderArtifact.findFirst({ where: { tenantId: input.tenantId, id: update.artifactId, ownerProjectId: input.projectId, deletedAt: null } });
        if (!artifact || update.source.metadata.id !== artifact.id || update.source.kind !== artifact.artifactType) throw new BadRequestException(`Only project-owned artifact ${update.artifactId} can be updated from project source`);
        const latest = await tx.artifactRevision.findFirst({ where: { tenantId: input.tenantId, artifactId: artifact.id }, orderBy: { revision: "desc" } });
        if ((latest?.revision ?? 0) !== update.expectedRevision) throw new ConflictException({ message: "Artifact revision conflict", artifactId: artifact.id, expectedRevision: update.expectedRevision, currentRevision: latest?.revision ?? 0, currentHash: latest?.contentHash ?? null });
        if (latest?.contentHash === update.contentHash) { results.push(latest); continue; }
        results.push(await tx.artifactRevision.create({ data: { tenantId: input.tenantId, artifactId: artifact.id, revision: (latest?.revision ?? 0) + 1, parentRevisionId: latest?.id ?? null, apiVersion: update.source.apiVersion, schemaVersion: 1, source: update.source, contentHash: update.contentHash, validationStatus: "VALID", validationResult: { issues: [] }, createdBy: input.createdBy ?? null, dependencies: { create: update.dependencies } }, include: { dependencies: true } }));
      }
      if (removals.length) {
        const now = new Date();
        await tx.builderArtifact.updateMany({ where: { tenantId: input.tenantId, id: { in: removals }, ownerProjectId: input.projectId }, data: { deletedAt: now, status: "ARCHIVED" } });
        await tx.builderArtifactAttachment.updateMany({ where: { tenantId: input.tenantId, artifactId: { in: removals }, projectId: input.projectId, detachedAt: null }, data: { detachedAt: now } });
      }
      return results;
    });
  }

  private async assertArtifactInScope(
    tenantId: string,
    artifactId: string,
    scope: ArtifactScope,
  ) {
    const artifact = await this.db.builderArtifact.findFirst({
      where: { tenantId, id: artifactId, deletedAt: null },
    });
    if (!artifact) throw new NotFoundException("Artifact not found");

    if (scope.kind === "LIBRARY") {
      if (artifact.ownerProjectId !== null) {
        throw new NotFoundException("Artifact is not in the Library");
      }
      return artifact;
    }

    const attachment = await this.db.builderArtifactAttachment.findFirst({
      where: {
        tenantId,
        artifactId,
        projectId: scope.projectId,
        detachedAt: null,
      },
    });
    if (!attachment) throw new NotFoundException("Artifact is not visible in this project");
    return artifact;
  }
}
