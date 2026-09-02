import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { builderManifestForKind, type CanonicalArtifactKind } from "@kannan19302/contracts";
import { prisma } from "@kannan19302/database";
import { releaseDigest } from "./project-releases.service";

type Conflict = { id: string; domain: string; key: string; change: string; current: any; incoming: any };
type Resolution = { action: "KEEP_CURRENT" | "APPLY_INCOMING"; approvedBreaking?: boolean; resourceMappings?: Record<string, unknown>; capabilityGrants?: unknown[] };
const canonical = (value: unknown) => releaseDigest(value);

@Injectable()
export class ProjectSourceDependencyImportService {
  private readonly db = prisma as any;

  async annotate(tenantId: string, projectId: string, conflicts: Conflict[]) {
    return Promise.all(conflicts.map(async (conflict) => ({ ...conflict, applyIncomingReady: conflict.domain === "PACKAGE_LOCK" && conflict.change === "CHANGE" ? await this.changeTargetExists(tenantId, projectId, conflict) : false })));
  }

  async prepare(tenantId: string, projectId: string, conflicts: Conflict[], resolutions: Record<string, Resolution>) {
    const operations = [] as any[];
    for (const conflict of conflicts) {
      const resolution = resolutions[conflict.id];
      if (resolution?.action !== "APPLY_INCOMING") continue;
      if (conflict.domain !== "PACKAGE_LOCK" || conflict.change !== "CHANGE") throw new ConflictException({ message: "This incoming dependency change requires its dedicated add/remove/binding resolution form", conflict });
      operations.push(await this.preparePackageChange(tenantId, projectId, conflict, resolution));
    }
    return operations.length ? async (tx: any) => { for (const operation of operations) await operation(tx); } : undefined;
  }

  private async changeTargetExists(tenantId: string, projectId: string, conflict: Conflict) {
    if (!conflict.incoming?.packageId || !conflict.incoming?.version || !conflict.incoming?.contentHash) return false;
    const [installation, target] = await Promise.all([
      this.db.projectInstallation.findFirst({ where: { tenantId, projectId, packageId: conflict.key, removedAt: null } }),
      this.db.devPackageVersion.findFirst({ where: { tenantId, packageId: conflict.key, version: conflict.incoming.version, contentHash: conflict.incoming.contentHash, status: "PUBLISHED" }, include: { package: true } }),
    ]);
    return Boolean(installation && target?.signature && target.package?.status === "ACTIVE");
  }

  private async preparePackageChange(tenantId: string, projectId: string, conflict: Conflict, resolution: Resolution) {
    const [project, installation, target] = await Promise.all([
      this.db.devProject.findFirst({ where: { tenantId, id: projectId } }),
      this.db.projectInstallation.findFirst({ where: { tenantId, projectId, packageId: conflict.key, removedAt: null }, include: { packageVersion: { include: { items: { include: { artifact: true, revision: true } } } } } }),
      this.db.devPackageVersion.findFirst({ where: { tenantId, packageId: conflict.key, version: conflict.incoming?.version, contentHash: conflict.incoming?.contentHash }, include: { package: true, items: { include: { artifact: true, revision: true } } } }),
    ]);
    if (!project) throw new NotFoundException("Project not found");
    if (!installation) throw new NotFoundException("Current package installation not found");
    if (!target || target.status !== "PUBLISHED" || !target.signature || target.package?.status !== "ACTIVE") throw new BadRequestException("Incoming package lock must resolve to an active signed published version");
    if (target.id === installation.packageVersionId) return async () => undefined;

    for (const item of target.items) {
      const manifest = builderManifestForKind(item.artifact.artifactType as CanonicalArtifactKind);
      if (!manifest?.portability.consumerProjectKinds.includes(project.kind) || !manifest.portability.installationModes.includes(installation.mode)) throw new BadRequestException(`Incoming package artifact ${item.artifactId} is incompatible with project kind ${project.kind} or mode ${installation.mode}`);
    }
    const mappings = resolution.resourceMappings ?? installation.resourceMappings ?? {};
    const requiredDependencies = Array.isArray(target.manifest?.dependencies) ? target.manifest.dependencies.filter((dependency: any) => !dependency.optional) : [];
    const missingMappings = requiredDependencies.filter((dependency: any) => !Object.hasOwn(mappings, dependency.alias)).map((dependency: any) => dependency.alias);
    if (missingMappings.length) throw new BadRequestException(`Incoming package requires resource mappings: ${missingMappings.join(", ")}`);
    const grants = resolution.capabilityGrants ?? installation.capabilityGrants ?? [];
    const granted = new Set(grants.map(canonical));
    const missingGrants = (Array.isArray(target.requiredCapabilities) ? target.requiredCapabilities : []).filter((capability: unknown) => !granted.has(canonical(capability)));
    if (missingGrants.length) throw new BadRequestException({ message: "Incoming package requires explicit capability grants", missingCapabilities: missingGrants });

    const currentByExport = new Map(installation.packageVersion.items.map((item: any) => [item.exportName, item]));
    const targetByExport = new Map(target.items.map((item: any) => [item.exportName, item]));
    const removedExports = [...currentByExport.keys()].filter((name) => !targetByExport.has(name));
    const changedExports = [...targetByExport.entries()].filter(([name, item]: any) => currentByExport.has(name) && (currentByExport.get(name) as any).revision.contentHash !== item.revision.contentHash).map(([name]) => name);
    if ((removedExports.length || changedExports.length) && !resolution.approvedBreaking) throw new ConflictException({ message: "Incoming package change requires explicit impact approval", impact: { removed: removedExports, changed: changedExports } });
    const oldArtifactIds = installation.packageVersion.items.map((item: any) => item.artifactId);
    const targetArtifactIds = new Set(target.items.map((item: any) => item.artifactId));
    const detach = oldArtifactIds.filter((id: string) => !targetArtifactIds.has(id));
    if (detach.length) {
      const dependencies = await this.db.artifactDependency.findMany({ where: { tenantId, targetArtifactId: { in: detach } }, include: { sourceRevision: { include: { artifact: true } } } });
      const blockers = dependencies.filter((dependency: any) => dependency.sourceRevision.artifact.ownerProjectId === projectId && !detach.includes(dependency.sourceRevision.artifactId));
      if (blockers.length) throw new ConflictException({ message: "Incoming package change would orphan project dependencies", blockers: blockers.map((item: any) => ({ sourceArtifactId: item.sourceRevision.artifactId, targetArtifactId: item.targetArtifactId, alias: item.alias })) });
    }
    const lock = { apiVersion: "unierp.lock/v1", packageId: target.packageId, packageVersionId: target.id, version: target.version, contentHash: target.contentHash, resolvedAt: new Date().toISOString() };
    return async (tx: any) => {
      const updated = await tx.projectInstallation.updateMany({ where: { id: installation.id, tenantId, projectId, packageVersionId: installation.packageVersionId, removedAt: null }, data: { packageVersionId: target.id, lock, resourceMappings: mappings, capabilityGrants: grants } });
      if (updated.count !== 1) throw new ConflictException("Package installation changed after source-import planning");
      for (const item of target.items) await tx.builderArtifactAttachment.upsert({ where: { artifactId_projectId: { artifactId: item.artifactId, projectId } }, create: { tenantId, artifactId: item.artifactId, projectId, isOwner: false }, update: { detachedAt: null } });
      if (detach.length) await tx.builderArtifactAttachment.updateMany({ where: { tenantId, projectId, artifactId: { in: detach }, isOwner: false, detachedAt: null }, data: { detachedAt: new Date() } });
    };
  }
}
