import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { prisma } from "@kannan19302/database";
import { ProjectSourceImportService } from "./project-source-import.service";
import { ProjectReleasesService } from "./project-releases.service";

@Injectable()
export class ProjectChangeSetsService {
  private readonly db = prisma as any;
  constructor(private readonly imports: ProjectSourceImportService, private readonly releases: ProjectReleasesService) {}

  list(tenantId: string, projectId: string) {
    return this.db.projectChangeSet.findMany({ where: { tenantId, projectId }, include: { reviews: { orderBy: { createdAt: "desc" } } }, orderBy: { createdAt: "desc" }, take: 50 });
  }

  async create(input: { tenantId: string; projectId: string; branch: string; title: string; description?: string | null; bundle: unknown; createdBy?: string | null }) {
    const plan = await this.imports.plan(input.tenantId, input.projectId, input.bundle);
    const change = await this.db.projectChangeSet.create({ data: { tenantId: input.tenantId, projectId: input.projectId, branch: input.branch, title: input.title, description: input.description ?? null, bundle: input.bundle, bundleHash: plan.bundleHash, baseFingerprint: plan.baseFingerprint, createdBy: input.createdBy ?? null } });
    await this.audit(input.tenantId, input.projectId, "CHANGESET_CREATED", input.createdBy, { changeSetId: change.id, branch: change.branch, bundleHash: change.bundleHash });
    return change;
  }

  async submit(tenantId: string, projectId: string, id: string, submittedBy: string) {
    const change = await this.find(tenantId, projectId, id, ["DRAFT"]);
    if (change.createdBy && change.createdBy !== submittedBy) throw new ConflictException("Only the changeset author can submit its draft for review");
    const submitted = await this.db.projectChangeSet.update({ where: { id: change.id }, data: { status: "IN_REVIEW", submittedAt: new Date() } });
    await this.audit(tenantId, projectId, "CHANGESET_SUBMITTED", submittedBy, { changeSetId: change.id });
    return submitted;
  }

  async review(input: { tenantId: string; projectId: string; id: string; reviewerId: string; decision: "APPROVED" | "REJECTED"; comment?: string | null }) {
    const change = await this.find(input.tenantId, input.projectId, input.id, ["IN_REVIEW"]);
    if (change.createdBy && change.createdBy === input.reviewerId) throw new ConflictException("A changeset author cannot approve their own changeset");
    await this.db.projectChangeSetReview.upsert({ where: { changeSetId_reviewerId: { changeSetId: change.id, reviewerId: input.reviewerId } }, create: { tenantId: input.tenantId, changeSetId: change.id, reviewerId: input.reviewerId, decision: input.decision, comment: input.comment ?? null }, update: { decision: input.decision, comment: input.comment ?? null } });
    const reviews = await this.db.projectChangeSetReview.findMany({ where: { tenantId: input.tenantId, changeSetId: change.id } });
    const status = reviews.some((review: any) => review.decision === "REJECTED") ? "REJECTED" : reviews.some((review: any) => review.decision === "APPROVED") ? "APPROVED" : "IN_REVIEW";
    const reviewed = await this.db.projectChangeSet.update({ where: { id: change.id }, data: { status } });
    await this.audit(input.tenantId, input.projectId, "CHANGESET_REVIEWED", input.reviewerId, { changeSetId: change.id, decision: input.decision, status });
    return reviewed;
  }

  async merge(input: { tenantId: string; projectId: string; id: string; mergedBy: string }) {
    const change = await this.find(input.tenantId, input.projectId, input.id, ["APPROVED"]);
    const current = await this.releases.currentComposition(input.tenantId, input.projectId);
    if (current.fingerprint !== change.baseFingerprint) throw new ConflictException("Changeset base is stale; rebase and submit a new reviewed changeset");
    const claim = await this.db.projectChangeSet.updateMany({ where: { id: change.id, status: "APPROVED" }, data: { status: "MERGING" } });
    if (claim.count !== 1) throw new ConflictException("Changeset merge is already in progress or completed");
    try {
      const result = await this.imports.apply(input.tenantId, input.projectId, change.bundle, input.mergedBy);
      await this.db.projectChangeSet.update({ where: { id: change.id }, data: { status: "MERGED", mergedAt: new Date(), mergedBy: input.mergedBy } });
      await this.audit(input.tenantId, input.projectId, "CHANGESET_MERGED", input.mergedBy, { changeSetId: change.id, bundleHash: change.bundleHash });
      return result;
    } catch (error) {
      // A failed apply is retryable. The compare-on-state update never
      // overwrites a concurrently recovered/merged record.
      await this.db.projectChangeSet.updateMany({ where: { id: change.id, status: "MERGING" }, data: { status: "APPROVED" } });
      throw error;
    }
  }

  private async find(tenantId: string, projectId: string, id: string, statuses: string[]) {
    const change = await this.db.projectChangeSet.findFirst({ where: { tenantId, projectId, id, status: { in: statuses } } });
    if (!change) throw new NotFoundException("Changeset was not found in the required lifecycle state");
    return change;
  }

  private async audit(tenantId: string, projectId: string, action: string, actorId: string | null | undefined, metadata: Record<string, unknown>) {
    try { await this.db.developerAuditEvent?.create?.({ data: { tenantId, projectId, action, actorId: actorId ?? null, metadata } }); } catch { /* audit writing must not make an immutable lifecycle transition ambiguous */ }
  }
}
