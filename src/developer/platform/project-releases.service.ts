import { Injectable, NotFoundException, ConflictException } from "@nestjs/common";
import { prisma } from "@kannan19302/database";
import { Prisma } from "@prisma/client";
import { isUniqueViolation } from "./prisma-errors";
import { ModuleCompositionService } from "./module-composition.service";

/**
 * `ProjectRelease` — plan phase P6.
 *
 * One release model for both Apps and Sites, because `DevProject` is one id
 * space over both. `AppRelease` could only ever version an App; a Site
 * publish had nowhere to record what it published.
 */
@Injectable()
export class ProjectReleasesService {
  constructor(private readonly composition: ModuleCompositionService) {}

  async list(tenantId: string, projectId: string) {
    return prisma.projectRelease.findMany({
      where: { tenantId, projectId },
      orderBy: { createdAt: "desc" },
    });
  }

  /**
   * Freeze the project's current authored state at `version`.
   *
   * The snapshot is taken here rather than by the caller so a release can
   * never disagree with what was actually authored: for an App it is the
   * module's own JSON plus its artifact registry rows, for a Site its pages
   * and settings. `@@unique([projectId, version])` is what stops the same
   * version being published twice with different contents.
   */
  async publish(input: {
    tenantId: string;
    projectId: string;
    version: string;
    changelog?: string;
    publishedBy?: string | null;
  }) {
    const { tenantId, projectId, version } = input;

    const project = await prisma.devProject.findFirst({
      where: { tenantId, id: projectId },
    });
    if (!project) throw new NotFoundException("Project not found");

    const snapshot = await this.snapshotOf(tenantId, project);

    try {
      return await prisma.projectRelease.create({
        data: {
          tenantId,
          projectId,
          version,
          changelog: input.changelog ?? null,
          snapshot: snapshot as Prisma.InputJsonValue,
          status: "PUBLISHED",
          publishedBy: input.publishedBy ?? null,
          publishedAt: new Date(),
        },
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException(
          `Version "${version}" has already been published for this project.`,
        );
      }
      throw err;
    }
  }

  /**
   * Rolls back by publishing the old snapshot forward as a NEW release
   * rather than mutating history. A release is meant to be immutable — if
   * rollback rewrote or deleted rows, "what was live on Tuesday" would stop
   * being answerable, which is the main thing a release table is for.
   */
  async rollbackTo(input: {
    tenantId: string;
    projectId: string;
    releaseId: string;
    version: string;
    publishedBy?: string | null;
  }) {
    const source = await prisma.projectRelease.findFirst({
      where: {
        tenantId: input.tenantId,
        projectId: input.projectId,
        id: input.releaseId,
      },
    });
    if (!source) throw new NotFoundException("Release not found");

    return prisma.$transaction(async (tx) => {
      await tx.projectRelease.update({
        where: { id: source.id },
        data: { status: "ROLLED_BACK" },
      });
      return tx.projectRelease.create({
        data: {
          tenantId: input.tenantId,
          projectId: input.projectId,
          version: input.version,
          releaseType: "HOTFIX",
          changelog: `Rollback to ${source.version}`,
          snapshot: source.snapshot as Prisma.InputJsonValue,
          status: "PUBLISHED",
          publishedBy: input.publishedBy ?? null,
          publishedAt: new Date(),
        },
      });
    });
  }

  private async snapshotOf(
    tenantId: string,
    project: { id: string; kind: string; appId: string | null; siteId: string | null },
  ): Promise<Record<string, unknown>> {
    const artifacts = await prisma.builderArtifact.findMany({
      where: { tenantId, ownerProjectId: project.id, deletedAt: null },
      select: { artifactType: true, artifactId: true, name: true, status: true },
    });

    if (project.kind === "APP" && project.appId) {
      const app = await prisma.builderModule.findFirst({
        where: { tenantId, id: project.appId },
      });
      return {
        kind: "APP",
        artifacts,
        entities: app?.entities ?? [],
        relationships: app?.relationships ?? [],
        permissions: app?.permissions ?? {},
        // P4: read from the real tables, not the dropped JSON columns.
        pages: await this.composition.pages(tenantId, project.appId),
        dataModels: await this.composition.dataModels(tenantId, project.appId),
        components: await this.composition.components(tenantId, project.appId),
        meta: { name: app?.name, slug: app?.slug, version: app?.version },
      };
    }

    if (project.kind === "SITE" && project.siteId) {
      const [site, pages] = await Promise.all([
        prisma.webSite.findFirst({ where: { tenantId, id: project.siteId } }),
        prisma.webSitePage.findMany({
          where: { tenantId, siteId: project.siteId },
          select: { path: true, title: true, type: true, blocks: true, seo: true, status: true },
        }),
      ]);
      return {
        kind: "SITE",
        artifacts,
        pages,
        theme: site?.theme ?? {},
        settings: site?.settings ?? {},
        meta: { name: site?.name, slug: site?.slug },
      };
    }

    // The xor CHECK on dev_projects makes this unreachable; returning a
    // minimal snapshot rather than throwing means a malformed row cannot
    // block an unrelated publish.
    return { kind: project.kind, artifacts };
  }
}
