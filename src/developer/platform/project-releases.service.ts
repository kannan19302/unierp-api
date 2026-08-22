import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { prisma } from "@kannan19302/database";
import { assertReleaseManifestV1, builderManifestForKind, type CanonicalArtifactKind, type ReleaseManifestV1 } from "@kannan19302/contracts";
import { createHash, createPublicKey, randomUUID, verify } from "node:crypto";
import { Prisma } from "@prisma/client";
import { isUniqueViolation } from "./prisma-errors";
import { ProjectGovernorService } from "./project-governor.service";
import { findArtifactDependencyCycles } from "./dependency-graph";
import { DeveloperEntitlementsService } from "./developer-entitlements.service";
import { RuntimePlanCacheInvalidationService } from "./runtime-plan-cache-invalidation.service";

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/;
const COMPILER = "unierp-metadata-compiler@1.0.0";
type Approval = { userId: string; role?: string; approvedAt?: string };

function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([, child]) => child !== undefined).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, child]) => [key, normalize(child)]));
  return value;
}

export const canonicalReleaseJson = (value: unknown) => JSON.stringify(normalize(value));
export const releaseDigest = (value: unknown) => createHash("sha256").update(canonicalReleaseJson(value)).digest("hex");

@Injectable()
export class ProjectReleasesService {
  private readonly db = prisma as any;
  constructor(private readonly governor: ProjectGovernorService = new ProjectGovernorService(), private readonly entitlements?: DeveloperEntitlementsService, private readonly runtimeInvalidation?: RuntimePlanCacheInvalidationService) {}

  list(tenantId: string, projectId: string) {
    return this.db.projectRelease.findMany({ where: { tenantId, projectId }, orderBy: { createdAt: "desc" } });
  }

  listValidations(tenantId: string, projectId: string) {
    return this.db.projectValidationRun.findMany({ where: { tenantId, projectId }, orderBy: { startedAt: "desc" }, take: 25 });
  }

  /** Shared immutable composition resolver for validation, test, and release paths. */
  currentComposition(tenantId: string, projectId: string) {
    return this.composition(tenantId, projectId);
  }

  async validate(input: { tenantId: string; projectId: string; startedBy?: string | null }) {
    const c = await this.composition(input.tenantId, input.projectId);
    const governor = this.governor.evaluate(c, this.entitlements ? await this.entitlements.limits(input.tenantId) : undefined);
    const dependencyCycles = findArtifactDependencyCycles(c.artifacts);
    const latestTest = await this.db.projectTestRun?.findFirst?.({ where: { tenantId: input.tenantId, projectId: input.projectId, sourceFingerprint: c.fingerprint, status: "PASSED" }, orderBy: { completedAt: "desc" } });
    const hasTestSuites = c.artifacts.some((artifact) => artifact.artifactType === "TEST_SUITE");
    const checks = [
      this.check("artifacts.valid", c.invalidArtifacts, `${c.artifacts.length} immutable artifact revisions are valid.`),
      this.check("packages.signed-and-locked", c.invalidPackages, `${c.packages.length} package locks are signed and exact.`),
      this.check("dependencies.mapped", c.missingMappings, "All required dependencies are mapped."),
      this.check("capabilities.granted", c.missingCapabilities, "All requested capabilities are granted."),
      this.check("builders.runtime-supported", c.unsupportedBuilders, "Every artifact has a deployable server-authoritative builder manifest."),
      this.check("test-suites.passed", hasTestSuites && !latestTest ? ["No passing test run exists for this exact composition"] : [], hasTestSuites ? "Test suites passed for this exact composition." : "No test suites are configured."),
      this.check("governor.hard-limits", governor.filter((finding) => finding.level === "FAIL").map((finding) => finding.message), "Composition is within hard resource limits."),
      this.check("dependencies.acyclic", dependencyCycles.map((cycle) => cycle.join(" → ")), "Resolved artifact dependencies are acyclic."),
    ];
    const builds: any[] = [];
    for (const artifact of c.artifacts) {
      builds.push(await this.db.artifactBuild.upsert({
        where: { revisionId_compilerId_compilerVersion: { revisionId: artifact.revisionId, compilerId: "unierp-metadata-compiler", compilerVersion: "1.0.0" } },
        create: { tenantId: input.tenantId, revisionId: artifact.revisionId, compilerId: "unierp-metadata-compiler", compilerVersion: "1.0.0", sourceHash: artifact.sourceHash, outputHash: artifact.compiledHash, diagnostics: [] },
        update: { sourceHash: artifact.sourceHash, outputHash: artifact.compiledHash, status: "SUCCESS", diagnostics: [] },
      }));
    }
    const passed = checks.every((check) => check.status === "PASS");
    const run = await this.db.projectValidationRun.create({ data: {
      tenantId: input.tenantId, projectId: input.projectId, sourceFingerprint: c.fingerprint,
      status: passed ? "PASSED" : "FAILED", score: Math.round(checks.filter((x) => x.status === "PASS").length / checks.length * 100),
      checks: checks as Prisma.InputJsonValue,
      evidence: [...builds.map((build: any) => ({ kind: "ARTIFACT_BUILD", id: build.id, digest: build.outputHash })), ...governor.map((finding) => ({ kind: `GOVERNOR_${finding.level}`, id: finding.dimension, digest: String(finding.usage) }))] as Prisma.InputJsonValue,
      startedBy: input.startedBy ?? null, completedAt: new Date(),
    }});
    await this.audit(input.tenantId, input.projectId, "VALIDATION_COMPLETED", input.startedBy, { sourceFingerprint: c.fingerprint, status: run.status, score: run.score });
    return run;
  }

  async preparePublish(input: { tenantId: string; projectId: string; version: string; changelog?: string; policyBundleVersion?: string; releaseId?: string }) {
    if (!SEMVER.test(input.version)) throw new BadRequestException("version must use semantic versioning");
    const c = await this.composition(input.tenantId, input.projectId);
    const validation = await this.db.projectValidationRun.findFirst({ where: { tenantId: input.tenantId, projectId: input.projectId, sourceFingerprint: c.fingerprint, status: "PASSED" }, orderBy: { completedAt: "desc" } });
    if (!validation) throw new ConflictException("The exact current project composition has not passed validation");
    const releaseId = input.releaseId ?? this.nextReleaseId();
    const unsigned = {
      apiVersion: "unierp.release/v1" as const, releaseId, projectId: input.projectId, projectRevision: c.fingerprint,
      packages: c.packages,
      artifacts: c.artifacts.map(({ artifactId, revision, sourceHash, compiledHash }) => ({ artifactId, revision, sourceHash, compiledHash })),
      migrations: [], requiredBindings: c.requiredBindings, evidence: validation.evidence as ReleaseManifestV1["evidence"],
      policy: { bundleVersion: input.policyBundleVersion ?? "developer-release/v1", decisions: ["validation.passed", "packages.signed", "composition.immutable"], approvals: [] },
      provenance: { builder: "unierp-release-service", toolchain: COMPILER, sbomDigest: releaseDigest(c.packages) },
    };
    return { unsigned, manifestHash: releaseDigest(unsigned), validation };
  }

  async publish(input: { tenantId: string; projectId: string; version: string; changelog?: string; keyId: string; signature: string; releaseId?: string; approvals?: Approval[]; policyBundleVersion?: string; publishedBy?: string | null }) {
    const { unsigned, manifestHash, validation } = await this.preparePublish(input);
    const key = await this.db.devSigningKey.findFirst({ where: { tenantId: input.tenantId, keyId: input.keyId, status: "ACTIVE", revokedAt: null } });
    if (!key) throw new NotFoundException("Active signing key not found");
    let valid = false;
    try { valid = verify(null, Buffer.from(manifestHash, "utf8"), createPublicKey({ key: Buffer.from(key.publicKey, "base64"), format: "der", type: "spki" }), Buffer.from(input.signature, "base64")); } catch { valid = false; }
    if (!valid) throw new BadRequestException("Release signature is invalid");
    const manifest: ReleaseManifestV1 = { ...unsigned, provenance: { ...unsigned.provenance, signature: input.signature } };
    assertReleaseManifestV1(manifest);
    try {
      const release = await this.db.projectRelease.create({ data: {
        id: unsigned.releaseId, tenantId: input.tenantId, projectId: input.projectId, version: input.version,
        changelog: input.changelog ?? null, snapshot: manifest as unknown as Prisma.InputJsonValue,
        manifestHash, signature: input.signature, signingKeyId: input.keyId, sourceFingerprint: unsigned.projectRevision,
        policyBundleVersion: unsigned.policy.bundleVersion, testScore: validation.score, status: "PUBLISHED",
        publishedBy: input.publishedBy ?? null, publishedAt: new Date(),
      }});
      await this.audit(input.tenantId, input.projectId, "RELEASE_PUBLISHED", input.publishedBy, { releaseId: release.id, version: release.version, manifestHash });
      return release;
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException(`Version "${input.version}" has already been published for this project.`);
      throw error;
    }
  }

  async approveRelease(input: { tenantId: string; projectId: string; releaseId: string; userId: string }) {
    const release = await this.db.projectRelease.findFirst({ where: { tenantId: input.tenantId, projectId: input.projectId, id: input.releaseId, status: "PUBLISHED" } });
    if (!release) throw new NotFoundException("Published release not found");
    const approval = await this.db.projectReleaseApproval.upsert({
      where: { releaseId_userId: { releaseId: input.releaseId, userId: input.userId } },
      create: { tenantId: input.tenantId, projectId: input.projectId, releaseId: input.releaseId, userId: input.userId, status: "APPROVED" },
      update: { status: "APPROVED" },
    });
    await this.audit(input.tenantId, input.projectId, "RELEASE_APPROVED", input.userId, { releaseId: input.releaseId });
    return approval;
  }

  async deploy(input: { tenantId: string; projectId: string; releaseId: string; environmentId: string; strategy?: string; approvals?: Approval[]; deployedBy: string; rollbackFrom?: string }) {
    const [release, environment] = await Promise.all([
      this.db.projectRelease.findFirst({ where: { tenantId: input.tenantId, projectId: input.projectId, id: input.releaseId, status: "PUBLISHED" } }),
      this.db.environment.findFirst({ where: { tenantId: input.tenantId, id: input.environmentId, status: "ACTIVE" } }),
    ]);
    if (!release) throw new NotFoundException("Published release not found");
    if (!environment) throw new NotFoundException("Active environment not found");
    const manifest = release.snapshot as unknown as ReleaseManifestV1;
    assertReleaseManifestV1(manifest);
    const approvalRows = await this.db.projectReleaseApproval?.findMany?.({ where: { tenantId: input.tenantId, projectId: input.projectId, releaseId: input.releaseId, status: "APPROVED" } }) ?? [];
    const approvalIds = new Set(approvalRows.map((approval: any) => approval.userId));
    if (environment.type === "PRODUCTION" && approvalIds.size < 2) throw new ConflictException("Production deployment requires two distinct recorded approvals");
    const bindings = await this.db.environmentBinding.findMany({ where: { tenantId: input.tenantId, projectId: input.projectId, environmentId: input.environmentId } });
    const verified = new Set<string>(bindings.filter((x: any) => x.status === "VERIFIED").map((x: any) => x.key));
    const missing = manifest.requiredBindings.filter((x) => !verified.has(x.key));
    if (missing.length) throw new ConflictException(`Environment bindings are missing or unverified: ${missing.map((x) => x.key).join(", ")}`);
    const deployment = await this.db.$transaction(async (tx: any) => {
      await tx.$executeRawUnsafe?.("SELECT pg_advisory_xact_lock(hashtext($1))", `${input.tenantId}:${input.environmentId}`);
      const lockedEnvironment = await tx.environment.findFirst?.({ where: { tenantId: input.tenantId, id: input.environmentId, status: "ACTIVE" } }) ?? environment;
      if (input.rollbackFrom && (lockedEnvironment.metadata as any)?.activeDeveloperRelease?.deploymentId !== input.rollbackFrom) throw new ConflictException("The deployment being rolled back is no longer active");
      const now = new Date();
      const deployment = await tx.deployment.create({ data: {
        tenantId: input.tenantId, name: `${release.version} to ${environment.name}`, application: input.projectId,
        version: release.version, environmentId: input.environmentId, releaseId: release.id, status: "SUCCESS",
        strategy: input.strategy ?? "ROLLING", deployedBy: input.deployedBy, startedAt: now, completedAt: now,
        rollbackFrom: input.rollbackFrom ?? null, metadata: { manifestHash: release.manifestHash, approvals: [...approvalIds] },
        stages: { create: [
          { tenantId: input.tenantId, name: "Policy gate", sequence: 1, status: "SUCCESS", startedAt: now, completedAt: now },
          { tenantId: input.tenantId, name: "Activate manifest", sequence: 2, status: "SUCCESS", startedAt: now, completedAt: now },
        ]},
      }});
      const oldMetadata = lockedEnvironment.metadata && typeof lockedEnvironment.metadata === "object" ? lockedEnvironment.metadata as Record<string, unknown> : {};
      await tx.environment.update({ where: { id: environment.id }, data: { lastDeployAt: now, metadata: { ...oldMetadata, activeDeveloperRelease: { projectId: input.projectId, releaseId: release.id, manifestHash: release.manifestHash, deploymentId: deployment.id } } } });
      if (input.rollbackFrom) await tx.deployment.update({ where: { id: input.rollbackFrom }, data: { status: "ROLLED_BACK", rollbackTo: deployment.id } });
      return deployment;
    });
    await this.runtimeInvalidation?.invalidateTenant(input.tenantId);
    await this.audit(input.tenantId, input.projectId, input.rollbackFrom ? "DEPLOYMENT_ROLLED_BACK" : "RELEASE_DEPLOYED", input.deployedBy, { deploymentId: deployment.id, releaseId: release.id, environmentId: environment.id, rollbackFrom: input.rollbackFrom ?? null, manifestHash: release.manifestHash });
    return deployment;
  }

  async rollbackDeployment(input: { tenantId: string; projectId: string; deploymentId: string; targetReleaseId: string; approvals?: Approval[]; deployedBy: string }) {
    const current = await this.db.deployment.findFirst({ where: { tenantId: input.tenantId, id: input.deploymentId, application: input.projectId, status: "SUCCESS" } });
    if (!current) throw new NotFoundException("Successful deployment not found");
    const environment = await this.db.environment.findFirst({ where: { tenantId: input.tenantId, id: current.environmentId, status: "ACTIVE" } });
    if (!environment || (environment.metadata as any)?.activeDeveloperRelease?.deploymentId !== current.id) throw new ConflictException("Only the currently active deployment can be rolled back");
    if (current.releaseId === input.targetReleaseId) throw new ConflictException("Rollback target must differ from the active release");
    const [currentRelease, targetRelease] = await Promise.all([
      this.db.projectRelease.findFirst({ where: { tenantId: input.tenantId, projectId: input.projectId, id: current.releaseId, status: "PUBLISHED" } }),
      this.db.projectRelease.findFirst({ where: { tenantId: input.tenantId, projectId: input.projectId, id: input.targetReleaseId, status: "PUBLISHED" } }),
    ]);
    if (!currentRelease || !targetRelease) throw new NotFoundException("Active or target published release not found");
    if (!currentRelease.publishedAt || !targetRelease.publishedAt || targetRelease.publishedAt >= currentRelease.publishedAt) throw new ConflictException("Rollback target must be a previously published release");
    return this.deploy({ ...input, releaseId: input.targetReleaseId, environmentId: current.environmentId, strategy: current.strategy, rollbackFrom: current.id });
  }

  private check(id: string, failures: string[], passMessage: string) {
    return { id, status: failures.length ? "FAIL" as const : "PASS" as const, message: failures.length ? failures.join(", ") : passMessage };
  }

  private async audit(tenantId: string, projectId: string, action: string, actorId: string | null | undefined, metadata: Record<string, unknown>) {
    try { await this.db.developerAuditEvent?.create?.({ data: { tenantId, projectId, action, actorId: actorId ?? null, metadata } }); } catch { /* audit availability never makes a signed lifecycle write ambiguous */ }
  }

  protected nextReleaseId() {
    return randomUUID();
  }

  private async composition(tenantId: string, projectId: string) {
    const project = await this.db.devProject.findFirst({ where: { tenantId, id: projectId } });
    if (!project) throw new NotFoundException("Project not found");
    const [owned, installs] = await Promise.all([
      this.db.builderArtifact.findMany({ where: { tenantId, ownerProjectId: projectId, deletedAt: null }, include: { revisions: { orderBy: { revision: "desc" }, take: 1, include: { dependencies: true } } } }),
      this.db.projectInstallation.findMany({ where: { tenantId, projectId, status: "ACTIVE" }, include: { package: true, packageVersion: { include: { items: { include: { artifact: true, revision: { include: { dependencies: true } } } } } } } }),
    ]);
    const rows = [...owned.flatMap((artifact: any) => artifact.revisions.map((revision: any) => ({ artifact, revision }))), ...installs.flatMap((install: any) => install.packageVersion.items.map((item: any) => ({ artifact: item.artifact, revision: item.revision })))];
    const unique = new Map<string, any>(); rows.forEach((row) => unique.set(row.revision.id, row));
    const artifacts = [...unique.values()].map(({ artifact, revision }) => ({ artifactId: artifact.id, artifactType: artifact.artifactType, revisionId: revision.id, revision: revision.revision, sourceHash: revision.contentHash, compiledHash: releaseDigest({ compiler: COMPILER, sourceHash: revision.contentHash, source: revision.source }), source: revision.source, validationStatus: revision.validationStatus, dependencies: revision.dependencies })).sort((a, b) => a.artifactId.localeCompare(b.artifactId));
    const packages = installs.map((x: any) => ({ packageId: x.packageId, version: x.packageVersion.version, contentHash: x.packageVersion.contentHash, editability: x.package.editability })).sort((a: any, b: any) => a.packageId.localeCompare(b.packageId));
    const missingMappings: string[] = [], missingCapabilities: string[] = [];
    const required = new Map<string, { key: string; kind: string; requiredCapabilities: string[] }>();
    for (const install of installs) {
      const mappings = install.resourceMappings as Record<string, string>, grants = new Set((install.capabilityGrants as string[]) ?? []);
      install.packageVersion.items.flatMap((item: any) => item.revision.dependencies).forEach((dep: any) => { if (!dep.optional && !mappings?.[dep.alias]) missingMappings.push(dep.alias); });
      for (const capability of (install.packageVersion.requiredCapabilities as string[]) ?? []) {
        if (!grants.has(capability)) missingCapabilities.push(capability);
        if (capability.startsWith("binding:")) { const key = capability.slice(8); required.set(key, { key, kind: "SECRET_OR_SERVICE", requiredCapabilities: [capability] }); }
      }
    }
    const invalidArtifacts = artifacts.filter((x) => x.validationStatus !== "VALID").map((x) => x.artifactId);
    const unsupportedBuilders = artifacts
      .filter((artifact) => {
        const manifest = builderManifestForKind(artifact.artifactType as CanonicalArtifactKind);
        return !manifest || manifest.status === "PLANNED";
      })
      .map((artifact) => `${artifact.artifactId}:${artifact.artifactType}`);
    const invalidPackages = installs.filter((x: any) => x.package.status !== "ACTIVE" || x.packageVersion.status !== "PUBLISHED" || !x.packageVersion.signature || x.mode !== "PINNED").map((x: any) => `${x.package.namespace}.${x.package.name}@${x.packageVersion.version}`);
    const fingerprint = releaseDigest({ project: { id: project.id, kind: project.kind }, packages, artifacts: artifacts.map(({ source, validationStatus, dependencies, revisionId, ...x }) => x) });
    return { artifacts, packages, fingerprint, invalidArtifacts, invalidPackages, unsupportedBuilders, missingMappings: [...new Set(missingMappings)].sort(), missingCapabilities: [...new Set(missingCapabilities)].sort(), requiredBindings: [...required.values()].sort((a, b) => a.key.localeCompare(b.key)) };
  }
}
