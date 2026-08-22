import { InjectQueue } from "@nestjs/bullmq";
import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import type { Queue } from "bullmq";
import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@kannan19302/database";
import { enqueueTrackedJob } from "../../common/queues/job-tracking.util";
import { DeveloperEntitlementsService } from "./developer-entitlements.service";
import { DEFAULT_GOVERNOR_LIMITS } from "./project-governor.service";
import { ProjectReleasesService } from "./project-releases.service";
import { DeveloperWorkloadMeteringService } from "./developer-workload-metering.service";
import { PreviewSubmissionsService } from "./preview-submissions.service";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
@Injectable()
export class ProjectPreviewService {
  private readonly db = prisma as any;
  constructor(private readonly releases: ProjectReleasesService, @InjectQueue("developer-preview") private readonly queue: Queue, private readonly entitlements?: DeveloperEntitlementsService, private readonly metering?: DeveloperWorkloadMeteringService, private readonly submissions?: PreviewSubmissionsService) {}
  list(tenantId: string, projectId: string) { return this.db.projectPreviewSession.findMany({ where: { tenantId, projectId }, orderBy: { createdAt: "desc" }, take: 25, select: { id: true, sourceFingerprint: true, context: true, status: true, expiresAt: true, createdAt: true, revokedAt: true } }); }
  async create(input: { tenantId: string; projectId: string; context?: { role?: string; locale?: string; device?: string; fixture?: string }; createdBy?: string | null }) {
    const current = await this.releases.currentComposition(input.tenantId, input.projectId);
    if (current.invalidPackages?.length) throw new BadRequestException("Preview cannot include suspended or invalid packages");
    const limits = await this.entitlements?.limits(input.tenantId);
    const limit = limits?.previewSessions ?? DEFAULT_GOVERNOR_LIMITS.previewSessions;
    const token = randomBytes(32).toString("base64url"); const expiresAt = new Date(Date.now() + 30 * 60_000);
    let activeSessions = 0;
    const session = await this.db.$transaction(async (tx: any) => {
      // Serializes admission per tenant without a global lock. Parameter binding
      // keeps the opaque tenant id out of SQL text.
      await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(hashtext($1))", input.tenantId);
      activeSessions = await tx.projectPreviewSession.count({ where: { tenantId: input.tenantId, status: { in: ["PENDING", "ACTIVE"] }, expiresAt: { gt: new Date() }, revokedAt: null } });
      if (activeSessions >= limit.hard) throw new BadRequestException(`Preview session limit reached (${activeSessions}/${limit.hard})`);
      return tx.projectPreviewSession.create({ data: { tenantId: input.tenantId, projectId: input.projectId, sourceFingerprint: current.fingerprint, tokenHash: hash(token), context: input.context ?? {}, status: "PENDING", expiresAt, createdBy: input.createdBy ?? null } });
    });
    await this.audit(input.tenantId, input.projectId, "PREVIEW_REQUESTED", input.createdBy ?? null, { previewId: session.id, sourceFingerprint: current.fingerprint, governor: { activeSessions: activeSessions + 1, hardLimit: limit.hard } });
    try {
      const job = await enqueueTrackedJob(this.queue, {
        tenantId: input.tenantId,
        jobType: "prepare-project-preview",
        payload: { tenantId: input.tenantId, projectId: input.projectId, previewId: session.id, requestedAt: new Date().toISOString() },
        priority: 4,
      });
      return { id: session.id, token, sourceFingerprint: current.fingerprint, expiresAt, context: session.context, status: "PENDING", job, governor: { activeSessions: activeSessions + 1, softLimit: limit.soft, hardLimit: limit.hard, level: activeSessions + 1 > limit.soft ? "WARN" : "PASS" } };
    } catch (error) {
      await this.db.projectPreviewSession.update({ where: { id: session.id }, data: { status: "FAILED" } });
      throw error;
    }
  }
  /** Idempotent worker operation. Sandbox adapters can be attached here without
   * changing token semantics or making the browser a control-plane authority. */
  async prepare(tenantId: string, previewId: string) {
    const session = await this.db.projectPreviewSession.findFirst({ where: { tenantId, id: previewId } });
    if (!session) throw new NotFoundException("Preview session not found");
    if (session.status === "ACTIVE") return session;
    if (session.status !== "PENDING" || session.expiresAt <= new Date() || session.revokedAt) throw new BadRequestException("Preview session is not eligible for preparation");
    const current = await this.releases.currentComposition(tenantId, session.projectId);
    if (current.fingerprint !== session.sourceFingerprint) throw new BadRequestException("Preview source is stale; create a new session");
    if (current.invalidPackages?.length) throw new BadRequestException("Preview cannot include suspended or invalid packages");
    const claimed = await this.db.projectPreviewSession.updateMany({ where: { id: session.id, status: "PENDING" }, data: { status: "ACTIVE" } });
    if (claimed.count) {
      await this.metering?.record({ tenantId, metric: "DEVELOPER_PREVIEW_SESSION", workloadId: session.id, projectId: session.projectId });
      await this.audit(tenantId, session.projectId, "PREVIEW_ACTIVATED", session.createdBy ?? null, { previewId: session.id, sourceFingerprint: session.sourceFingerprint });
      return { ...session, status: "ACTIVE" };
    }
    const resolved = await this.db.projectPreviewSession.findFirst({ where: { tenantId, id: previewId, status: "ACTIVE" } });
    if (resolved) return resolved;
    throw new BadRequestException("Preview session preparation was superseded");
  }
  async failPreparation(tenantId: string, previewId: string) {
    const failed = await this.db.projectPreviewSession.updateMany({ where: { tenantId, id: previewId, status: "PENDING" }, data: { status: "FAILED" } });
    if (failed.count) {
      const session = await this.db.projectPreviewSession.findFirst({ where: { tenantId, id: previewId } });
      if (session) await this.audit(tenantId, session.projectId, "PREVIEW_FAILED", session.createdBy ?? null, { previewId });
    }
  }
  async resolve(tenantId: string, token: string) {
    const session = await this.db.projectPreviewSession.findFirst({ where: { tenantId, tokenHash: hash(token), status: "ACTIVE", expiresAt: { gt: new Date() }, revokedAt: null } });
    if (!session) throw new NotFoundException("Active preview session not found");
    const current = await this.releases.currentComposition(tenantId, session.projectId);
    if (current.fingerprint !== session.sourceFingerprint) throw new BadRequestException("Preview source is stale; create a new session");
    if (current.invalidPackages?.length) throw new BadRequestException("Preview cannot include suspended or invalid packages");
    return { apiVersion: "unierp.preview-plan/v1", projectId: session.projectId, sourceFingerprint: session.sourceFingerprint, context: session.context, artifacts: current.artifacts.map((artifact) => ({ artifactId: artifact.artifactId, kind: artifact.artifactType, revision: artifact.revision, source: artifact.source })), packages: current.packages };
  }
  async submit(tenantId: string, token: string, input: { formArtifactId: string; values: Record<string, unknown>; createdBy?: string | null }) {
    if (!this.submissions) throw new BadRequestException("Preview submission adapter is unavailable");
    const session = await this.db.projectPreviewSession.findFirst({ where: { tenantId, tokenHash: hash(token), status: "ACTIVE", expiresAt: { gt: new Date() }, revokedAt: null } });
    if (!session) throw new NotFoundException("Active preview session not found");
    const current = await this.releases.currentComposition(tenantId, session.projectId);
    if (current.fingerprint !== session.sourceFingerprint) throw new BadRequestException("Preview source is stale; create a new session");
    if (current.invalidPackages?.length) throw new BadRequestException("Preview cannot include suspended or invalid packages");
    return this.submissions.submit({ tenantId, projectId: session.projectId, previewId: session.id, formArtifactId: input.formArtifactId, values: input.values, createdBy: input.createdBy, artifacts: current.artifacts.map((artifact: any) => ({ artifactId: artifact.artifactId, kind: artifact.artifactType, source: artifact.source })) });
  }
  async revoke(tenantId: string, projectId: string, id: string) { const session = await this.db.projectPreviewSession.findFirst({ where: { tenantId, projectId, id, status: { in: ["PENDING", "ACTIVE"] } } }); if (!session) throw new NotFoundException("Active or pending preview session not found"); const revoked = await this.db.projectPreviewSession.update({ where: { id }, data: { status: "REVOKED", revokedAt: new Date() } }); await this.audit(tenantId, projectId, "PREVIEW_REVOKED", session.createdBy ?? null, { previewId: id, previousStatus: session.status }); return revoked; }
  private async audit(tenantId: string, projectId: string, action: string, actorId: string | null, metadata: Record<string, unknown>) {
    try { await this.db.developerAuditEvent?.create({ data: { tenantId, projectId, action, actorId, metadata } }); } catch { /* audit availability must not orphan an already-created preview */ }
  }
}
