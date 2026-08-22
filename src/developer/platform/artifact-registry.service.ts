import { Injectable, NotFoundException, BadRequestException } from "@nestjs/common";
import { prisma } from "@kannan19302/database";

/** Concrete legacy projections that can be reconciled mechanically. Kinds not
 * listed here are canonical-only or have no one-row-per-artifact projection
 * yet, so reporting them as drift would be a false positive. */
export const RECONCILABLE_ARTIFACT_PROJECTIONS = [
  { type: "FORM", table: "builder_forms" },
  { type: "ADVANCED_FORM", table: "advanced_forms" },
  { type: "WORKFLOW", table: "builder_workflows" },
  { type: "BPMN_PROCESS", table: "bpmn_process_definitions" },
  { type: "DASHBOARD", table: "builder_dashboards" },
  { type: "DATA_OBJECT", table: "builder_data_models" },
  { type: "RULE_SET", table: "business_rules" },
  { type: "API_ENDPOINT", table: "builder_apis" },
  { type: "SCRIPT", table: "builder_scripts" },
  { type: "MOBILE_APP", table: "mobile_apps" },
  { type: "ETL_PIPELINE", table: "etl_pipelines" },
  { type: "THEME", table: "builder_themes" },
  { type: "PAGE", table: "web_site_pages" },
  { type: "COLLECTION", table: "web_collections" },
  { type: "BLOG_POST", table: "blog_posts" },
  { type: "MENU", table: "web_menus" },
  { type: "ASSET", table: "web_assets" },
  { type: "SEO_PROFILE", table: "web_seo" },
  { type: "AB_TEST", table: "ab_tests" },
  { type: "CONNECTOR_DEFINITION", table: "integration_connectors" },
  { type: "POLICY", table: "builder_permission_rules" },
] as const;

/**
 * The single write funnel for `builder_artifacts` — plan phase P3.
 *
 * `BuilderArtifact.artifactId` is polymorphic and therefore not a foreign
 * key (see `data/prisma/schema/developer-platform.prisma`), so the database
 * cannot stop a concrete artifact being created without a registry row. That
 * integrity has to live somewhere, and this service is the "somewhere":
 * every create/rename/status-change routes through `record()`, and
 * `reconcile()` reports what slipped past.
 *
 * The dual-write window this opens is the real risk of P3, and it is
 * deliberate: the legacy `/builder/*` controllers still write the concrete
 * tables directly and know nothing about the registry. Until the P4
 * controller split routes them through here, `reconcile()` is what closes
 * the gap, and it reports rather than silently repairing — an artifact that
 * appears in a concrete table with no registry row is a fact worth seeing,
 * not one worth papering over.
 */
@Injectable()
export class ArtifactRegistryService {
  /**
   * Upsert the registry row for a concrete artifact. Idempotent on
   * (tenantId, artifactType, artifactId), matching the unique index, so a
   * caller that records twice does not create a duplicate.
   */
  async record(input: {
    tenantId: string;
    artifactType: string;
    artifactId: string;
    name: string;
    slug?: string | null;
    status?: string;
    icon?: string | null;
    ownerProjectId?: string | null;
    createdBy?: string | null;
  }) {
    const { tenantId, artifactType, artifactId } = input;
    return prisma.builderArtifact.upsert({
      where: {
        tenantId_artifactType_artifactId: { tenantId, artifactType, artifactId },
      },
      create: {
        tenantId,
        artifactType,
        artifactId,
        name: input.name,
        slug: input.slug ?? null,
        status: input.status ?? "DRAFT",
        icon: input.icon ?? null,
        ownerProjectId: input.ownerProjectId ?? null,
        createdBy: input.createdBy ?? null,
      },
      // Ownership is NOT updated here. Moving an artifact between projects is
      // `attach`/`detach`, an explicit user action — a routine rename must
      // never silently re-home something.
      update: {
        name: input.name,
        slug: input.slug ?? null,
        status: input.status ?? undefined,
        icon: input.icon ?? null,
      },
    });
  }

  /** Retire a concrete legacy projection without erasing its registry identity
   * or attachment history.  This is the migration-safe counterpart of a
   * legacy table delete. */
  async retire(tenantId: string, artifactType: string, artifactId: string) {
    return prisma.builderArtifact.updateMany({
      where: { tenantId, artifactType, artifactId, deletedAt: null },
      data: { deletedAt: new Date() },
    });
  }

  /** Everything in the Library: authored, not owned by any project. */
  async listLibrary(tenantId: string, artifactType?: string) {
    return prisma.builderArtifact.findMany({
      where: {
        tenantId,
        ownerProjectId: null,
        deletedAt: null,
        ...(artifactType ? { artifactType } : {}),
      },
      orderBy: { updatedAt: "desc" },
    });
  }

  /**
   * Everything visible inside a project — owned OR attached. Reads the
   * attachment table alone, which is exactly why owned artifacts are
   * mirrored there with `isOwner = true`: without that mirror this would be
   * a union of two queries that could disagree.
   */
  async listForProject(tenantId: string, projectId: string, artifactType?: string) {
    const rows = await prisma.builderArtifactAttachment.findMany({
      where: { tenantId, projectId, detachedAt: null },
      include: { artifact: true },
      orderBy: { attachedAt: "desc" },
    });
    return rows
      .map((r) => r.artifact)
      .filter(
        (a) => a && a.deletedAt === null && (!artifactType || a.artifactType === artifactType),
      );
  }

  /**
   * Publish a Library artifact into a project. The user-facing action behind
   * "create one form, publish it to any existing app".
   *
   * Attaching does NOT transfer ownership: the artifact stays in the Library
   * and becomes visible in the target app as well. That is what makes it
   * publishable to several apps at once — the whole point of the Library
   * plane — and it is why `isOwner` stays false here.
   */
  async attach(input: {
    tenantId: string;
    artifactId: string;
    projectId: string;
    attachedBy?: string | null;
    /** P9 — pin this attachment to a specific `ProjectRelease` instead of
     * following the artifact's head. See `pin()` for what that means. */
    pinnedReleaseId?: string | null;
  }) {
    const { tenantId, artifactId, projectId } = input;

    const [artifact, project] = await Promise.all([
      prisma.builderArtifact.findFirst({ where: { tenantId, id: artifactId } }),
      prisma.devProject.findFirst({ where: { tenantId, id: projectId } }),
    ]);
    if (!artifact) throw new NotFoundException("Artifact not found");
    if (!project) throw new NotFoundException("Project not found");
    if (artifact.ownerProjectId === projectId) {
      throw new BadRequestException(
        "This artifact already belongs to that project.",
      );
    }

    if (input.pinnedReleaseId) {
      await this.assertReleaseBelongsToArtifactOwner(tenantId, input.pinnedReleaseId);
    }

    return prisma.builderArtifactAttachment.upsert({
      where: { artifactId_projectId: { artifactId, projectId } },
      create: {
        tenantId,
        artifactId,
        projectId,
        isOwner: false,
        attachedBy: input.attachedBy ?? null,
        pinnedReleaseId: input.pinnedReleaseId ?? null,
      },
      // Re-attaching something previously detached clears the tombstone
      // rather than creating a second row.
      update: {
        detachedAt: null,
        attachedBy: input.attachedBy ?? null,
        pinnedReleaseId: input.pinnedReleaseId ?? null,
      },
    });
  }

  /**
   * P9 — pin an existing attachment to a release, or unpin it (null) to go
   * back to following head.
   *
   * The point of pinning: App A and App B can both publish the same Library
   * form, and A can freeze on `v2` while B tracks whatever the author does
   * next. Without it, every edit to a shared artifact silently changes every
   * app consuming it — which is exactly the failure mode that makes teams
   * refuse to share anything.
   *
   * Follow-head remains the default. `pinnedReleaseId IS NULL` means "always
   * current", which is what every attachment created before this method
   * existed already meant, so nothing changes behaviour on upgrade.
   */
  async pin(input: {
    tenantId: string;
    artifactId: string;
    projectId: string;
    releaseId: string | null;
  }) {
    const { tenantId, artifactId, projectId, releaseId } = input;
    const row = await prisma.builderArtifactAttachment.findFirst({
      where: { tenantId, artifactId, projectId, detachedAt: null },
    });
    if (!row) throw new NotFoundException("Attachment not found");
    if (releaseId) {
      await this.assertReleaseBelongsToArtifactOwner(tenantId, releaseId);
    }
    return prisma.builderArtifactAttachment.update({
      where: { id: row.id },
      data: { pinnedReleaseId: releaseId },
    });
  }

  /**
   * A pin must name a release in the same tenant. Without this check a
   * caller could pin to any release id it could guess; the tenant scope is
   * enforced by RLS anyway, but failing with a clear 404 beats storing a
   * dangling pin that only surfaces later as an unresolvable version.
   */
  private async assertReleaseBelongsToArtifactOwner(
    tenantId: string,
    releaseId: string,
  ) {
    const release = await prisma.projectRelease.findFirst({
      where: { tenantId, id: releaseId },
      select: { id: true },
    });
    if (!release) throw new NotFoundException("Release not found");
  }

  /** Detach, by tombstone rather than delete, so the history of what was
   * once published where survives. Refuses to detach an owner row — that
   * would make the artifact invisible inside the project that owns it. */
  async detach(tenantId: string, artifactId: string, projectId: string) {
    const row = await prisma.builderArtifactAttachment.findFirst({
      where: { tenantId, artifactId, projectId },
    });
    if (!row) throw new NotFoundException("Attachment not found");
    if (row.isOwner) {
      throw new BadRequestException(
        "Cannot detach an artifact from the project that owns it.",
      );
    }
    return prisma.builderArtifactAttachment.update({
      where: { id: row.id },
      data: { detachedAt: new Date() },
    });
  }

  /**
   * Which projects a Library artifact has been published into. Drives the
   * "Published to N apps" affordance.
   */
  async attachmentsOf(tenantId: string, artifactId: string) {
    return prisma.builderArtifactAttachment.findMany({
      where: { tenantId, artifactId, detachedAt: null },
      include: { project: true },
    });
  }

  /**
   * Reports concrete artifacts with no registry row.
   *
   * Reports, never repairs. During the P4 dual-write window a missing row
   * means a legacy controller wrote directly to a concrete table, and the
   * useful output is which ones and how many — silently inserting would hide
   * exactly the drift this exists to measure.
   */
  async reconcile(tenantId: string): Promise<{
    artifactType: string;
    missing: number;
  }[]> {
    const out: { artifactType: string; missing: number }[] = [];
    for (const src of RECONCILABLE_ARTIFACT_PROJECTIONS) {
      // The table name is from the closed literal list above, never from
      // user input, so interpolating it is safe; the tenant id is still
      // parameterised.
      const rows = await prisma.$queryRawUnsafe<{ missing: bigint }[]>(
        `SELECT count(*) AS missing
           FROM "${src.table}" s
          WHERE s.tenant_id = $1
            AND NOT EXISTS (
              SELECT 1 FROM builder_artifacts a
               WHERE a.tenant_id = s.tenant_id
                 AND a.artifact_type = $2
                 AND a.artifact_id = s.id
            )`,
        tenantId,
        src.type,
      );
      const missing = Number(rows[0]?.missing ?? 0);
      if (missing > 0) out.push({ artifactType: src.type, missing });
    }
    return out;
  }
}
