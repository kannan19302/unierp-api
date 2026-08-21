import { Injectable, ConflictException, NotFoundException } from "@nestjs/common";
import { prisma } from "@kannan19302/database";
import { isUniqueViolation } from "./prisma-errors";

/**
 * `DevProject` — plan phase P1. See
 * `data/prisma/schema/developer-platform.prisma` for the model and why it
 * exists alongside `BuilderModule`/`WebSite` rather than replacing either.
 *
 * Every method here runs inside the caller's already-established tenant
 * session (this service is only ever reached from authenticated controllers
 * behind `JwtAuthGuard` + `TenantInterceptor`), so no method takes or checks
 * a `tenantId` parameter for its own queries beyond what RLS already
 * enforces — the one exception is `home`, which explicitly scopes its reads
 * because it aggregates across two source tables in parallel and the
 * aggregation reads benefit from being explicit about which tenant they're
 * for, the same defense-in-depth posture `TenantInterceptor`'s own raw-SQL
 * fallback uses.
 */
@Injectable()
export class DevProjectsService {
  private slugify(input: string): string {
    return (
      input
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "") || "untitled"
    );
  }

  /** The developer platform home page: every app, every site, no filtering.
   * Kept as two flat lists rather than one merged/paginated feed — the home
   * page renders "Apps" and "Sites" as two separate sections by design (see
   * the reshape plan's route tree), so merging them here would just make the
   * controller re-split what this method joined. */
  async home(tenantId: string) {
    const [apps, sites] = await Promise.all([
      prisma.devProject.findMany({
        where: { tenantId, kind: "APP", archivedAt: null },
        orderBy: { updatedAt: "desc" },
      }),
      prisma.devProject.findMany({
        where: { tenantId, kind: "SITE", archivedAt: null },
        orderBy: { updatedAt: "desc" },
      }),
    ]);
    return { apps, sites };
  }

  async recents(tenantId: string, userId: string, limit = 8) {
    const rows = await prisma.devProjectRecent.findMany({
      where: { tenantId, userId },
      orderBy: { lastOpenedAt: "desc" },
      take: limit,
      include: { project: true },
    });
    return rows
      .filter((r) => r.project && !r.project.archivedAt)
      .map((r) => ({ ...r.project, lastOpenedAt: r.lastOpenedAt }));
  }

  /** Upserted every time a user enters a project's workspace — see
   * `WorkspaceShellClient` on the frontend, which calls this once per
   * project-scoped layout mount. */
  async touchRecent(tenantId: string, userId: string, projectId: string) {
    return prisma.devProjectRecent.upsert({
      where: { userId_projectId: { userId, projectId } },
      create: { tenantId, userId, projectId },
      update: { lastOpenedAt: new Date(), openCount: { increment: 1 } },
    });
  }

  async getById(tenantId: string, id: string) {
    const project = await prisma.devProject.findFirst({ where: { tenantId, id } });
    if (!project) throw new NotFoundException("Project not found");
    return project;
  }

  /**
   * Creates a `BuilderModule` (App) and its `DevProject` identity row
   * together, in one transaction, so the invariant "every APP-kind
   * DevProject has a live BuilderModule" can never observe a half-created
   * pair. The two-table write is temporary scaffolding: once artifact
   * ownership moves fully onto `DevProject` (plan phase P3), app creation
   * becomes a single insert.
   */
  async createApp(
    tenantId: string,
    createdBy: string | undefined,
    input: { name: string; description?: string },
  ) {
    const slug = this.slugify(input.name);
    const existing = await prisma.devProject.findUnique({
      where: { tenantId_kind_slug: { tenantId, kind: "APP", slug } },
    });
    if (existing) {
      throw new ConflictException(
        `An app named "${input.name}" already exists in this tenant.`,
      );
    }

    try {
      return await prisma.$transaction(async (tx) => {
        const app = await tx.builderModule.create({
          data: {
            tenantId,
            name: input.name,
            slug,
            description: input.description,
            createdBy,
          },
        });
        return tx.devProject.create({
          data: {
            tenantId,
            kind: "APP",
            name: app.name,
            slug: app.slug,
            description: app.description,
            status: app.status,
            appId: app.id,
            createdBy,
          },
        });
      });
    } catch (err) {
      // The pre-check above only sees apps created through THIS service.
      // The legacy `/builder/modules` route still writes `BuilderModule`
      // directly with no `DevProject` counterpart (see the reshape plan's
      // migration notes on why both paths coexist) — a slug it already took
      // is invisible to the check above and only surfaces here, as Postgres's
      // own `@@unique([tenantId, slug])` on `builder_modules`.
      if (isUniqueViolation(err)) {
        throw new ConflictException(
          `An app named "${input.name}" already exists in this tenant.`,
        );
      }
      throw err;
    }
  }

  /** Mirrors `createApp` for the Site side — see that method's comment. */
  async createSite(
    tenantId: string,
    createdBy: string | undefined,
    input: { name: string; slug?: string },
  ) {
    const slug = this.slugify(input.slug || input.name);
    const existing = await prisma.devProject.findUnique({
      where: { tenantId_kind_slug: { tenantId, kind: "SITE", slug } },
    });
    if (existing) {
      throw new ConflictException(
        `A site named "${input.name}" already exists in this tenant.`,
      );
    }

    try {
      return await prisma.$transaction(async (tx) => {
        const site = await tx.webSite.create({
          data: { tenantId, name: input.name, slug, createdBy },
        });
        return tx.devProject.create({
          data: {
            tenantId,
            kind: "SITE",
            name: site.name,
            slug: site.slug,
            status: site.status,
            siteId: site.id,
            createdBy,
          },
        });
      });
    } catch (err) {
      // See the matching comment in `createApp` — the legacy
      // `/builder/web-studio/sites` route bypasses `DevProject` entirely.
      if (isUniqueViolation(err)) {
        throw new ConflictException(
          `A site named "${input.name}" already exists in this tenant.`,
        );
      }
      throw err;
    }
  }
}
