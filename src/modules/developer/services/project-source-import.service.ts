import { BadRequestException, ConflictException, Injectable } from "@nestjs/common";
import { assertArtifactEnvelopeV1 } from "@kannan19302/contracts";
import { ProjectReleasesService, releaseDigest } from "./project-releases.service";
import { ArtifactRevisionsService, artifactContentHash } from "./artifact-revisions.service";
import { DeveloperAuditService } from "./developer-audit.service";
import { ProjectSourceDependencyImportService } from "./project-source-dependency-import.service";

type ImportResolution = "KEEP_CURRENT" | "APPLY_INCOMING" | { action: "KEEP_CURRENT" | "APPLY_INCOMING"; approvedBreaking?: boolean; resourceMappings?: Record<string, unknown>; capabilityGrants?: unknown[] };

@Injectable()
export class ProjectSourceImportService {
  constructor(private readonly releases: ProjectReleasesService, private readonly revisions: ArtifactRevisionsService, private readonly audit?: DeveloperAuditService, private readonly dependencyImport?: ProjectSourceDependencyImportService) {}
  async plan(tenantId: string, projectId: string, input: any) {
    if (input?.apiVersion !== "unierp.project-source/v1" || input?.projectId !== projectId || !Array.isArray(input.artifacts) || typeof input.bundleHash !== "string") throw new BadRequestException("Invalid project source bundle");
    const { bundleHash, ...unsigned } = input;
    if (releaseDigest(unsigned) !== bundleHash) throw new BadRequestException("Source bundle hash does not match its content");
    this.validateDependencySections(input.packages, input.requiredBindings);
    for (const artifact of input.artifacts) {
      try { assertArtifactEnvelopeV1(artifact.source); } catch (error) { throw new BadRequestException(`Invalid source for ${artifact.id}: ${error instanceof Error ? error.message : "unknown validation failure"}`); }
      if (artifact.source.metadata.id !== artifact.id || artifact.source.kind !== artifact.kind) throw new BadRequestException(`Artifact identity mismatch for ${artifact.id}`);
      if (artifactContentHash(artifact.source) !== artifact.contentHash) throw new BadRequestException(`Content hash does not match source for ${artifact.id}`);
    }
    const current = await this.releases.currentComposition(tenantId, projectId);
    if (input.sourceFingerprint !== current.fingerprint) throw new ConflictException("Source bundle base fingerprint is stale; export the current project source and resolve conflicts before import");
    const packageConflicts = this.diffByKey(current.packages ?? [], input.packages ?? [], (item: any) => String(item.packageId), "PACKAGE_LOCK");
    const bindingConflicts = this.diffByKey(current.requiredBindings ?? [], input.requiredBindings ?? [], (item: any) => String(item.key), "REQUIRED_BINDING");
    const existing = new Map(current.artifacts.map((artifact) => [artifact.artifactId, artifact]));
    const incoming = new Map(input.artifacts.map((artifact: any) => [artifact.id, artifact]));
    const added = [...incoming.keys()].filter((id) => !existing.has(id));
    const removed = [...existing.keys()].filter((id) => !incoming.has(id));
    const changed = [...incoming.entries()]
      .filter(([id, artifact]: any) => existing.has(id) && existing.get(id)!.sourceHash !== artifact.contentHash)
      .map(([id, artifact]: any) => { const current = existing.get(id)!; return { id, expectedRevision: current.revision, incomingRevision: artifact.revision, from: current.sourceHash, to: artifact.contentHash }; });
    const rawConflicts = [...packageConflicts, ...bindingConflicts];
    const conflicts = this.dependencyImport ? await this.dependencyImport.annotate(tenantId, projectId, rawConflicts) : rawConflicts;
    return { apiVersion: "unierp.project-source-import-plan/v1", projectId, baseFingerprint: current.fingerprint, bundleHash, changes: { added, changed, removed }, conflicts, requiresConfirmation: added.length + changed.length + removed.length + conflicts.length > 0 };
  }
  async apply(tenantId: string, projectId: string, input: any, createdBy?: string | null, resolutions: Record<string, ImportResolution> = {}) {
    const plan = await this.plan(tenantId, projectId, input);
    const normalized = Object.fromEntries(Object.entries(resolutions).map(([id, resolution]) => [id, typeof resolution === "string" ? { action: resolution } : resolution]));
    const unresolved = plan.conflicts.filter((conflict: any) => !normalized[conflict.id]);
    if (unresolved.length) throw new ConflictException({ message: "Every package-lock and binding conflict requires an explicit resolution", conflicts: unresolved });
    const incoming = plan.conflicts.filter((conflict: any) => normalized[conflict.id]?.action === "APPLY_INCOMING");
    if (incoming.length && !this.dependencyImport) throw new ConflictException({ message: "Applying incoming dependencies requires the governed reconciliation adapter", conflicts: incoming });
    const mutateProject = await this.dependencyImport?.prepare(tenantId, projectId, plan.conflicts, normalized as any);
    const incomingArtifacts = new Map(input.artifacts.map((artifact: any) => [artifact.id, artifact]));
    let result: unknown;
    if (mutateProject || plan.changes.added.length && plan.changes.changed.length || plan.changes.removed.length && (plan.changes.added.length || plan.changes.changed.length)) {
      result = await this.revisions.applyImportedProjectCreateAndUpdate({ tenantId, projectId, createdBy: createdBy ?? null, additions: (plan.changes.added as string[]).map((id) => incomingArtifacts.get(id) as { id: string; kind: string; source: unknown }), updates: plan.changes.changed.map((change: any) => ({ artifactId: change.id, expectedRevision: change.expectedRevision, source: (incomingArtifacts.get(change.id) as any).source })), removals: plan.changes.removed as string[], mutateProject });
    } else if (plan.changes.added.length) {
      result = await this.revisions.createImportedProjectArtifacts({ tenantId, projectId, createdBy: createdBy ?? null, artifacts: (plan.changes.added as string[]).map((id) => incomingArtifacts.get(id) as { id: string; kind: string; source: unknown }) });
    } else if (plan.changes.removed.length) {
      result = await this.revisions.softDeleteImportedProjectArtifacts({ tenantId, projectId, artifactIds: plan.changes.removed as string[] });
    } else {
      result = await this.revisions.createBatch({ tenantId, scope: { kind: "PROJECT", projectId }, createdBy: createdBy ?? null, changes: plan.changes.changed.map((change: any) => ({ artifactId: change.id, expectedRevision: change.expectedRevision, source: (incomingArtifacts.get(change.id) as any).source })) });
    }
    await this.audit?.record({ tenantId, projectId, action: "PROJECT_SOURCE_IMPORTED", actorId: createdBy ?? null, metadata: { bundleHash: plan.bundleHash, baseFingerprint: plan.baseFingerprint, changes: { added: plan.changes.added.length, changed: plan.changes.changed.length, removed: plan.changes.removed.length }, conflictResolutions: plan.conflicts.map((conflict: any) => ({ id: conflict.id, resolution: normalized[conflict.id]?.action })) } });
    return result;
  }

  private diffByKey(current: any[], incoming: any[], keyOf: (item: any) => string, domain: "PACKAGE_LOCK" | "REQUIRED_BINDING") {
    const before = new Map(current.map((item) => [keyOf(item), item]));
    const after = new Map(incoming.map((item) => [keyOf(item), item]));
    const keys = [...new Set([...before.keys(), ...after.keys()])].sort();
    return keys.flatMap((key) => {
      const from = before.get(key), to = after.get(key);
      if (from !== undefined && to !== undefined && releaseDigest(from) === releaseDigest(to)) return [];
      const change = !from ? "ADD" : !to ? "REMOVE" : "CHANGE";
      return [{ id: `${domain}:${key}`, domain, key, change, current: from ?? null, incoming: to ?? null, supportedResolutions: ["KEEP_CURRENT", "APPLY_INCOMING"], applyIncomingReady: false }];
    });
  }

  private validateDependencySections(packages: unknown, requiredBindings: unknown) {
    if (!Array.isArray(packages) || !Array.isArray(requiredBindings)) throw new BadRequestException("Source bundle packages and requiredBindings must be arrays");
    const packageIds = new Set<string>();
    for (const item of packages) {
      const lock = item as any;
      if (!lock || typeof lock.packageId !== "string" || !lock.packageId || typeof lock.version !== "string" || !lock.version || typeof lock.contentHash !== "string" || !/^[a-f0-9]{64}$/i.test(lock.contentHash) || typeof lock.editability !== "string") throw new BadRequestException("Invalid package lock in source bundle");
      if (packageIds.has(lock.packageId)) throw new BadRequestException(`Duplicate package lock: ${lock.packageId}`);
      packageIds.add(lock.packageId);
    }
    const bindingKeys = new Set<string>();
    for (const item of requiredBindings) {
      const binding = item as any;
      if (!binding || typeof binding.key !== "string" || !binding.key || typeof binding.kind !== "string" || !Array.isArray(binding.requiredCapabilities)) throw new BadRequestException("Invalid required binding in source bundle");
      if (bindingKeys.has(binding.key)) throw new BadRequestException(`Duplicate required binding: ${binding.key}`);
      bindingKeys.add(binding.key);
    }
  }
}
