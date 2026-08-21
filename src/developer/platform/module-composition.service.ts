import { Injectable } from "@nestjs/common";
import { prisma } from "@kannan19302/database";

/**
 * Reads and writes what used to live in `builder_modules`' three JSON
 * columns — `components`, `pages`, `dataModels` — from the real tables that
 * replaced them, while returning the **exact same array shapes** the JSON
 * held.
 *
 * This is the load-bearing piece of plan phase P4, and the reason P8 can
 * finally drop those columns. The first P8 attempt failed with 86 compile
 * errors across the legacy builder services, every one a read of a dropped
 * column. Rewriting 86 call sites by hand would have been churn on code P4
 * eventually deletes; giving them one service that speaks their existing
 * vocabulary moves the storage without touching the contract.
 *
 * What each maps to:
 *   components  -> `builder_artifacts` owned by the module's DevProject (P3)
 *   pages       -> `builder_module_pages`
 *   dataModels  -> `builder_module_data_models`
 *
 * The shapes returned here are the ones `/api/v1/builder/modules/:id/*` has
 * always returned, so no client sees a change. That is the point: a
 * deprecation must not become a silent breaking change.
 */
@Injectable()
export class ModuleCompositionService {
  /** `[{id, type, refId, name}]` — the old `components` array. */
  async components(tenantId: string, moduleId: string) {
    const project = await prisma.devProject.findFirst({
      where: { tenantId, appId: moduleId },
      select: { id: true },
    });
    if (!project) return [];

    const rows = await prisma.builderArtifact.findMany({
      where: { tenantId, ownerProjectId: project.id, deletedAt: null },
      orderBy: { createdAt: "asc" },
    });
    return rows.map((r) => ({
      id: r.id,
      type: ARTIFACT_TYPE_TO_COMPONENT[r.artifactType] ?? r.artifactType.toLowerCase(),
      refId: r.artifactId,
      name: r.name,
    }));
  }

  /**
   * Adds a component by taking ownership of an existing artifact. The old
   * JSON version appended a `{type, refId}` object; the registry equivalent
   * is setting `ownerProjectId`, which is strictly better — it is the same
   * fact recorded once instead of in two places that could disagree.
   */
  async addComponent(
    tenantId: string,
    moduleId: string,
    input: { type: string; refId: string; name?: string },
  ) {
    const project = await prisma.devProject.findFirst({
      where: { tenantId, appId: moduleId },
      select: { id: true },
    });
    if (!project) return null;

    const artifactType = COMPONENT_TO_ARTIFACT_TYPE[input.type] ?? input.type.toUpperCase();
    const artifact = await prisma.builderArtifact.findFirst({
      where: { tenantId, artifactType, artifactId: input.refId },
    });
    if (!artifact) return null;

    const updated = await prisma.builderArtifact.update({
      where: { id: artifact.id },
      data: { ownerProjectId: project.id },
    });
    // Mirror into the attachment table with isOwner, so "everything in this
    // project" stays a single query — see BuilderArtifactAttachment's comment.
    await prisma.builderArtifactAttachment.upsert({
      where: { artifactId_projectId: { artifactId: artifact.id, projectId: project.id } },
      create: { tenantId, artifactId: artifact.id, projectId: project.id, isOwner: true },
      update: { isOwner: true, detachedAt: null },
    });
    return {
      id: updated.id,
      type: input.type,
      refId: updated.artifactId,
      name: updated.name,
    };
  }

  /** Removing a component returns the artifact to the Library rather than
   * deleting it — the artifact outlives the app that used it. */
  async removeComponent(tenantId: string, moduleId: string, componentId: string) {
    const project = await prisma.devProject.findFirst({
      where: { tenantId, appId: moduleId },
      select: { id: true },
    });
    if (!project) return false;

    const artifact = await prisma.builderArtifact.findFirst({
      where: { tenantId, id: componentId, ownerProjectId: project.id },
    });
    if (!artifact) return false;

    await prisma.builderArtifact.update({
      where: { id: artifact.id },
      data: { ownerProjectId: null },
    });
    await prisma.builderArtifactAttachment.deleteMany({
      where: { artifactId: artifact.id, projectId: project.id, isOwner: true },
    });
    return true;
  }

  /** `[{id, name, slug, type, formId, dashboardId}]` — the old `pages`. */
  async pages(tenantId: string, moduleId: string) {
    const rows = await prisma.builderModulePage.findMany({
      where: { tenantId, moduleId },
      orderBy: { sortOrder: "asc" },
    });
    return rows.map((p) => ({
      id: p.id,
      name: p.name,
      slug: p.slug,
      type: p.type,
      formId: p.formId ?? undefined,
      dashboardId: p.dashboardId ?? undefined,
      layout: p.layout,
    }));
  }

  async addPage(
    tenantId: string,
    moduleId: string,
    input: {
      name: string;
      slug: string;
      type?: string;
      formId?: string | null;
      dashboardId?: string | null;
      layout?: unknown;
    },
  ) {
    const count = await prisma.builderModulePage.count({ where: { tenantId, moduleId } });
    return prisma.builderModulePage.create({
      data: {
        tenantId,
        moduleId,
        name: input.name,
        slug: input.slug,
        type: input.type ?? "form",
        formId: input.formId ?? null,
        dashboardId: input.dashboardId ?? null,
        layout: (input.layout ?? []) as never,
        sortOrder: count,
      },
    });
  }

  async updatePage(
    tenantId: string,
    moduleId: string,
    pageId: string,
    input: {
      name?: string;
      slug?: string;
      type?: string;
      formId?: string | null;
      dashboardId?: string | null;
      layout?: unknown;
    },
  ) {
    const existing = await prisma.builderModulePage.findFirst({
      where: { tenantId, moduleId, id: pageId },
    });
    if (!existing) return null;
    return prisma.builderModulePage.update({
      where: { id: existing.id },
      data: {
        name: input.name ?? undefined,
        slug: input.slug ?? undefined,
        type: input.type ?? undefined,
        formId: input.formId ?? undefined,
        dashboardId: input.dashboardId ?? undefined,
        layout: (input.layout ?? undefined) as never,
      },
    });
  }

  async removePage(tenantId: string, moduleId: string, pageId: string) {
    const { count } = await prisma.builderModulePage.deleteMany({
      where: { tenantId, moduleId, id: pageId },
    });
    return count > 0;
  }

  /** `[{id, name, fields, relationships}]` — the old `dataModels`. */
  async dataModels(tenantId: string, moduleId: string) {
    const rows = await prisma.builderModuleDataModel.findMany({
      where: { tenantId, moduleId },
      orderBy: { sortOrder: "asc" },
    });
    return rows.map((d) => ({
      id: d.id,
      name: d.name,
      fields: d.fields,
      relationships: d.relationships,
    }));
  }

  async addDataModel(
    tenantId: string,
    moduleId: string,
    input: { name: string; fields?: unknown; relationships?: unknown },
  ) {
    const count = await prisma.builderModuleDataModel.count({ where: { tenantId, moduleId } });
    return prisma.builderModuleDataModel.create({
      data: {
        tenantId,
        moduleId,
        name: input.name,
        fields: (input.fields ?? []) as never,
        relationships: (input.relationships ?? []) as never,
        sortOrder: count,
      },
    });
  }

  async removeDataModel(tenantId: string, moduleId: string, dataModelId: string) {
    const { count } = await prisma.builderModuleDataModel.deleteMany({
      where: { tenantId, moduleId, id: dataModelId },
    });
    return count > 0;
  }

  /**
   * Restores a release snapshot's `components` / `pages` / `dataModels` into
   * the real tables — the rollback path that used to just overwrite three
   * JSON columns.
   *
   * Replace-all rather than merge, deliberately: a rollback means "make it
   * look exactly like it did at that release", and merging would leave rows
   * created after the release still present, which is the opposite of what
   * the caller asked for.
   */
  async restoreFromSnapshot(
    tenantId: string,
    moduleId: string,
    snapshot: { components?: unknown; pages?: unknown; dataModels?: unknown },
  ) {
    const pages = Array.isArray(snapshot.pages) ? (snapshot.pages as any[]) : null;
    const dataModels = Array.isArray(snapshot.dataModels)
      ? (snapshot.dataModels as any[])
      : null;
    const components = Array.isArray(snapshot.components)
      ? (snapshot.components as any[])
      : null;

    if (pages) {
      await prisma.builderModulePage.deleteMany({ where: { tenantId, moduleId } });
      for (const [i, p] of pages.entries()) {
        await prisma.builderModulePage.create({
          data: {
            id: typeof p?.id === "string" && p.id ? p.id : undefined,
            tenantId,
            moduleId,
            name: String(p?.name ?? "Untitled"),
            slug: String(p?.slug ?? `page-${i}`),
            type: String(p?.type ?? "form"),
            formId: p?.formId ?? null,
            dashboardId: p?.dashboardId ?? null,
            layout: (p?.layout ?? []) as never,
            sortOrder: i,
          },
        });
      }
    }

    if (dataModels) {
      await prisma.builderModuleDataModel.deleteMany({ where: { tenantId, moduleId } });
      for (const [i, d] of dataModels.entries()) {
        await prisma.builderModuleDataModel.create({
          data: {
            id: typeof d?.id === "string" && d.id ? d.id : undefined,
            tenantId,
            moduleId,
            name: String(d?.name ?? "Untitled"),
            fields: (d?.fields ?? []) as never,
            relationships: (d?.relationships ?? []) as never,
            sortOrder: i,
          },
        });
      }
    }

    if (components) {
      const project = await prisma.devProject.findFirst({
        where: { tenantId, appId: moduleId },
        select: { id: true },
      });
      if (project) {
        // Release everything currently owned, then re-own exactly what the
        // snapshot listed. Artifacts dropped by the rollback return to the
        // Library rather than being deleted.
        await prisma.builderArtifact.updateMany({
          where: { tenantId, ownerProjectId: project.id },
          data: { ownerProjectId: null },
        });
        await prisma.builderArtifactAttachment.deleteMany({
          where: { tenantId, projectId: project.id, isOwner: true },
        });
        for (const c of components) {
          if (typeof c?.refId === "string" && typeof c?.type === "string") {
            await this.addComponent(tenantId, moduleId, {
              type: c.type,
              refId: c.refId,
              name: c.name,
            });
          }
        }
      }
    }
  }

  /** Counts, for the stats endpoints that used to read `.length` off the JSON. */
  async counts(tenantId: string, moduleId: string) {
    const [components, pages, dataModels] = await Promise.all([
      this.components(tenantId, moduleId).then((c) => c.length),
      prisma.builderModulePage.count({ where: { tenantId, moduleId } }),
      prisma.builderModuleDataModel.count({ where: { tenantId, moduleId } }),
    ]);
    return { components, pages, dataModels };
  }
}

/** The JSON stored lowercase component types; the registry stores artifact
 * types. Both directions are needed because the legacy API speaks the former
 * and must keep doing so. */
const COMPONENT_TO_ARTIFACT_TYPE: Record<string, string> = {
  form: "FORM",
  workflow: "WORKFLOW",
  automation: "WORKFLOW",
  dashboard: "DASHBOARD",
};

const ARTIFACT_TYPE_TO_COMPONENT: Record<string, string> = {
  FORM: "form",
  WORKFLOW: "workflow",
  DASHBOARD: "dashboard",
};
