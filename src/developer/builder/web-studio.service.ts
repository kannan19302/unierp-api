import { Injectable, NotFoundException, Optional } from "@nestjs/common";
import { prisma, runWithTenantSession } from "@kannan19302/database";
import { idpClient as idpPrisma } from "@/common/idp-client";
import { AiClient } from "../../common/integrations/ai-client";
import { ArtifactRegistryService } from "../platform/artifact-registry.service";
import { ArtifactRevisionsService } from "../platform/artifact-revisions.service";

/**
 * Web Studio multi-site engine. Owns sites, custom domains, site pages,
 * and the per-site AI chatbot. A tenant can run several sites, each served
 * at its own domain(s) from "/" via the web app's host-aware middleware.
 */
@Injectable()
export class WebStudioService {
  constructor(private readonly ai: AiClient, @Optional() private readonly artifacts?: ArtifactRegistryService, @Optional() private readonly revisions?: ArtifactRevisionsService) {}

  private async mirrorPage(tenantId: string, siteId: string, page: { id: string; title: string; path: string; status: string; blocks?: unknown; seo?: unknown }) {
    const project = await prisma.devProject.findFirst({ where: { tenantId, siteId }, select: { id: true } });
    const artifact = await this.artifacts?.record({ tenantId, artifactType: "PAGE", artifactId: page.id, name: page.title, slug: page.path, status: page.status, ownerProjectId: project?.id ?? null });
    if (!artifact || !project || !this.revisions) return;
    await this.revisions.syncLegacyProjection({ tenantId, artifactId: artifact.id, scope: { kind: "PROJECT", projectId: project.id }, source: {
      apiVersion: "unierp.dev/v1", kind: "PAGE", metadata: { id: artifact.id, namespace: `tenant.${tenantId}`, name: page.title },
      spec: { title: page.title, slug: page.path, sections: Array.isArray(page.blocks) ? page.blocks : [], seo: page.seo && typeof page.seo === "object" ? page.seo as Record<string, unknown> : {} },
      interfaces: { inputs: [], outputs: [], events: [] }, dependencies: [], capabilities: [], tests: [],
      extensions: { legacyProjection: { table: "web_site_pages", id: page.id, siteId } },
    } });
  }

  private slugify(s: string): string {
    return s
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "");
  }

  // ── Sites ──
  async listSites(tenantId: string) {
    return prisma.webSite.findMany({
      where: { tenantId },
      orderBy: { createdAt: "asc" },
      include: { domains: true, _count: { select: { pages: true } } },
    });
  }

  async getSite(tenantId: string, id: string) {
    const site = await prisma.webSite.findFirst({
      where: { id, tenantId },
      include: { domains: true, chatbots: true },
    });
    if (!site) throw new NotFoundException("Site not found");
    return site;
  }

  async createSite(
    tenantId: string,
    data: { name: string; slug?: string; theme?: any; settings?: any },
    userId?: string,
  ) {
    const slug = this.slugify(data.slug || data.name) || "site";
    // Keep the old Web Studio route compatible while preserving the project
    // identity invariant required by packages, releases and environments.
    return prisma.$transaction(async (tx: any) => {
      const site = await tx.webSite.create({
        data: {
          tenantId,
          name: data.name,
          slug,
          theme: data.theme ?? {},
          settings: data.settings ?? {},
          createdBy: userId,
        },
      });
      await tx.devProject.create({ data: { tenantId, kind: "SITE", name: site.name, slug: site.slug, status: site.status, siteId: site.id, createdBy: userId ?? null } });
      return site;
    });
  }

  async updateSite(
    tenantId: string,
    id: string,
    data: { name?: string; status?: string; theme?: any; settings?: any },
  ) {
    await this.getSite(tenantId, id);
    return prisma.webSite.update({
      where: { id },
      data: {
        name: data.name ?? undefined,
        status: data.status ?? undefined,
        theme: data.theme ?? undefined,
        settings: data.settings ?? undefined,
      },
    });
  }

  async deleteSite(tenantId: string, id: string) {
    await this.getSite(tenantId, id);
    await prisma.webSite.delete({ where: { id } });
    return { ok: true };
  }

  // ── Domains ──
  async addDomain(
    tenantId: string,
    siteId: string,
    host: string,
    isPrimary = false,
  ) {
    await this.getSite(tenantId, siteId);
    const normalized = host.toLowerCase().trim();
    if (isPrimary)
      await prisma.webDomain.updateMany({
        where: { siteId },
        data: { isPrimary: false },
      });
    return prisma.webDomain.create({
      data: { siteId, host: normalized, isPrimary, verified: true },
    });
  }

  async removeDomain(tenantId: string, siteId: string, domainId: string) {
    await this.getSite(tenantId, siteId);
    await prisma.webDomain.deleteMany({ where: { id: domainId, siteId } });
    return { ok: true };
  }

  // ── Site pages ──
  async listPages(tenantId: string, siteId: string) {
    await this.getSite(tenantId, siteId);
    return prisma.webSitePage.findMany({
      where: { siteId, tenantId },
      orderBy: [{ type: "asc" }, { sortOrder: "asc" }],
    });
  }

  async upsertPage(
    tenantId: string,
    siteId: string,
    data: {
      id?: string;
      path: string;
      title: string;
      type?: string;
      blocks?: any;
      seo?: any;
      status?: string;
    },
  ) {
    await this.getSite(tenantId, siteId);
    const path = data.path.startsWith("/") ? data.path : `/${data.path}`;
    if (data.id) {
      const existing = await prisma.webSitePage.findFirst({ where: { id: data.id, siteId, tenantId }, select: { id: true } });
      if (!existing) throw new NotFoundException("Site page not found");
      const updated = await prisma.webSitePage.update({
        where: { id: data.id },
        data: {
          path,
          title: data.title,
          type: (data.type || "PAGE").toUpperCase(),
          blocks: data.blocks ?? undefined,
          seo: data.seo ?? undefined,
          status: data.status ?? undefined,
        },
      });
      await this.mirrorPage(tenantId, siteId, updated);
      return updated;
    }
    const page = await prisma.webSitePage.upsert({
      where: { siteId_path: { siteId, path } },
      update: {
        title: data.title,
        type: (data.type || "PAGE").toUpperCase(),
        blocks: data.blocks ?? undefined,
        seo: data.seo ?? undefined,
        status: data.status ?? undefined,
      },
      create: {
        siteId,
        tenantId,
        path,
        title: data.title,
        type: (data.type || "PAGE").toUpperCase(),
        blocks: data.blocks ?? [],
        seo: data.seo ?? {},
        status: data.status || "DRAFT",
      },
    });
    await this.mirrorPage(tenantId, siteId, page);
    return page;
  }

  async deletePage(tenantId: string, siteId: string, pageId: string) {
    await this.getSite(tenantId, siteId);
    await prisma.webSitePage.deleteMany({
      where: { id: pageId, siteId, tenantId },
    });
    await this.artifacts?.retire(tenantId, "PAGE", pageId);
    return { ok: true };
  }

  // ── Chatbot config ──
  async getChatbot(tenantId: string, siteId: string) {
    await this.getSite(tenantId, siteId);
    const existing = await prisma.webChatbot.findFirst({
      where: { siteId, tenantId },
    });
    return existing || prisma.webChatbot.create({ data: { siteId, tenantId } });
  }

  async updateChatbot(
    tenantId: string,
    siteId: string,
    data: { name?: string; enabled?: boolean; config?: any; knowledge?: any },
  ) {
    const bot = await this.getChatbot(tenantId, siteId);
    return prisma.webChatbot.update({
      where: { id: bot.id },
      data: {
        name: data.name ?? undefined,
        enabled: data.enabled ?? undefined,
        config: data.config ?? undefined,
        knowledge: data.knowledge ?? undefined,
      },
    });
  }

  // ── Public host resolution + serving ──
  //
  // Every method below serves an ANONYMOUS visitor, so no `RequireSession`-
  // authenticated request ever reaches this code and `TenantInterceptor`
  // (which only fires for authenticated requests — see its own source) never
  // establishes a tenant session for it. Before this file's P0 fix, that
  // meant every query below ran with NO tenant context at all: under
  // `unerp_api` (NOBYPASSRLS, FORCE ROW LEVEL SECURITY on `web_sites` /
  // `web_site_pages` / `web_chatbots`) the database silently returned zero
  // rows for all of it — verified empirically against this dev database
  // before writing the fix, by clearing the tenant GUC on an existing row
  // and watching the row count drop to 0 with the query itself unchanged.
  // The public site feature was not leaking; it could not serve a single
  // page. But relying on `unerp_api`'s specific role configuration to fail
  // CLOSED was never a safe design — a connection string pointed at a
  // different role (an ops shortcut, a maintenance script run as the
  // BYPASSRLS-capable migration role) would have turned "broken" into
  // "leaking every tenant's site" with no code change at all.
  //
  // The fix: resolve host → tenant via `resolve_tenant_for_host`, a
  // SECURITY DEFINER SQL function (migration
  // `20260820000000_public_site_tenant_resolver`) that crosses the RLS
  // boundary for exactly one narrow, non-sensitive read — site id, tenant
  // id, status; nothing a visitor couldn't already infer from owning a
  // verified domain for that site — then run every subsequent query for the
  // request inside `runWithTenantSession`, the same primitive
  // `TenantInterceptor` uses for authenticated requests. From that point on,
  // RLS enforces the boundary itself; the code no longer has to get it right
  // by construction.

  /** Resolve a request Host header to `{siteId, tenantId}` via the
   * SECURITY DEFINER resolver — the one read in this file that intentionally
   * runs with no tenant session, because establishing one requires knowing
   * the tenant this function exists to discover. */
  private async resolveHostTenant(
    host?: string,
  ): Promise<{ siteId: string; tenantId: string } | null> {
    if (!host) return null;
    const cleanHost = (host.split(":")[0] || host).toLowerCase();
    const rows = await prisma.$queryRaw<
      { site_id: string; tenant_id: string; site_status: string }[]
    >`SELECT * FROM resolve_tenant_for_host(${cleanHost})`;
    const resolved = rows[0];
    if (!resolved || resolved.site_status !== "ACTIVE") return null;
    return { siteId: resolved.site_id, tenantId: resolved.tenant_id };
  }

  /**
   * Resolves `host` and runs `fn` inside that tenant's session, all as one
   * request. Every public entry point below is a one-line call to this —
   * the shape that makes "resolve, then query outside the session" (the bug
   * this file had) structurally impossible to reintroduce by accident.
   */
  private async withPublicSiteSession<T>(
    host: string | undefined,
    fn: (siteId: string) => Promise<T>,
  ): Promise<T | null> {
    const resolved = await this.resolveHostTenant(host);
    if (!resolved) return null;
    return runWithTenantSession(
      { tenantId: resolved.tenantId, userId: "public" },
      () => fn(resolved.siteId),
    );
  }

  /** Resolve a request Host header to its site (custom domain → default site).
   * Runs the returned site read inside the resolved tenant's session — a
   * caller that then makes further Prisma calls OUTSIDE this method's
   * `await` (as every caller here used to) is back outside any session, so
   * `getPublicSiteByHost` and `answerChat` below do not call this and then
   * query further; they call `withPublicSiteSession` themselves and do all
   * of their reads inside its callback. */
  async resolveSiteByHost(host?: string) {
    return this.withPublicSiteSession(host, (siteId) =>
      prisma.webSite.findUnique({ where: { id: siteId } }),
    );
  }

  async getPublicPage(siteId: string, path: string, tenantId?: string) {
    const normalized =
      path && path !== "" ? (path.startsWith("/") ? path : `/${path}`) : "/";
    const read = () =>
      prisma.webSitePage.findFirst({
        where: { siteId, path: normalized, status: "PUBLISHED" },
      });
    // Callers inside an established session (e.g. `getSitePage` below) pass
    // no `tenantId` and reuse the ambient one; this overload exists only for
    // a caller that has already resolved a session-worthy id elsewhere.
    const page = tenantId
      ? await runWithTenantSession({ tenantId, userId: "public" }, read)
      : await read();
    if (!page) throw new NotFoundException("Page not found");
    return page;
  }

  /** The combined "resolve host, then serve its page" read, as one session —
   * this is what `WebPublicController#getSitePage` calls; it replaces the
   * controller's previous two-step `resolveSiteByHost` then `getPublicPage`,
   * which ran as two separate, session-less calls. */
  async getPublicSitePage(host: string | undefined, path: string) {
    const result = await this.withPublicSiteSession(host, async (siteId) => {
      const normalized =
        path && path !== "" ? (path.startsWith("/") ? path : `/${path}`) : "/";
      const [site, page] = await Promise.all([
        prisma.webSite.findUnique({ where: { id: siteId } }),
        prisma.webSitePage.findFirst({
          where: { siteId, path: normalized, status: "PUBLISHED" },
        }),
      ]);
      return { site, page };
    });
    if (!result?.site || !result.page) {
      throw new NotFoundException("Site not found for host");
    }
    return {
      site: {
        id: result.site.id,
        name: result.site.name,
        theme: result.site.theme,
        settings: result.site.settings,
      },
      page: result.page,
    };
  }

  async getPublicSiteByHost(host?: string) {
    const result = await this.withPublicSiteSession(host, async (siteId) => {
      const site = await prisma.webSite.findUnique({ where: { id: siteId } });
      if (!site || site.status !== "ACTIVE") return null;
      const pages = await prisma.webSitePage.findMany({
        where: { siteId, status: "PUBLISHED" },
        select: { path: true, title: true, type: true },
        orderBy: { sortOrder: "asc" },
      });
      const chatbot = await prisma.webChatbot.findFirst({
        where: { siteId, enabled: true },
      });
      return { site, pages, chatbot };
    });
    if (!result) throw new NotFoundException("Site not found for host");
    return {
      site: {
        id: result.site.id,
        name: result.site.name,
        theme: result.site.theme,
        settings: result.site.settings,
      },
      pages: result.pages,
      chatbot: result.chatbot
        ? { name: result.chatbot.name, config: result.chatbot.config }
        : null,
    };
  }

  // ── AI chatbot answer (grounded in the site's content) ──
  async answerChat(
    host: string | undefined,
    message: string,
    history: { role: "user" | "assistant"; content: string }[] = [],
  ) {
    return this.withPublicSiteSession(host, (siteId) =>
      this.answerChatForSite(siteId, message, history),
    ).then((result) => {
      if (!result) throw new NotFoundException("Site not found for host");
      return result;
    });
  }

  private async answerChatForSite(
    siteId: string,
    message: string,
    history: { role: "user" | "assistant"; content: string }[],
  ) {
    const site = await prisma.webSite.findUnique({ where: { id: siteId } });
    if (!site) throw new NotFoundException("Site not found for host");

    const bot = await prisma.webChatbot.findFirst({
      where: { siteId: site.id, enabled: true },
    });
    if (!bot)
      return { reply: "Sorry, the assistant isn't available on this site." };

    const knowledge = (bot.knowledge as any) || {};
    const contextParts: string[] = [];

    // Pull published page titles + any text blocks for grounding.
    if (knowledge.usePages !== false) {
      const pages = await prisma.webSitePage.findMany({
        where: { siteId: site.id, status: "PUBLISHED" },
        select: { title: true, blocks: true },
      });
      for (const p of pages.slice(0, 25)) {
        const text = JSON.stringify(p.blocks)
          .replace(/<[^>]+>/g, " ")
          .slice(0, 600);
        contextParts.push(`PAGE "${p.title}": ${text}`);
      }
    }

    // Pull selected collections' published items.
    const collectionSlugs: string[] = Array.isArray(knowledge.collections)
      ? knowledge.collections
      : [];
    if (collectionSlugs.length) {
      const collections = await prisma.webCollection.findMany({
        where: {
          tenantId: site.tenantId,
          siteId: site.id,
          slug: { in: collectionSlugs },
        },
        include: { items: { where: { status: "PUBLISHED" }, take: 30 } },
      });
      for (const c of collections) {
        for (const item of c.items)
          contextParts.push(
            `${c.singular || c.name}: ${JSON.stringify(item.data).slice(0, 400)}`,
          );
      }
    }

    if (typeof knowledge.custom === "string" && knowledge.custom.trim())
      contextParts.push(`NOTES: ${knowledge.custom}`);

    const persona =
      (bot.config as any)?.persona ||
      `You are ${bot.name}, a friendly assistant for the website "${site.name}".`;
    const context = contextParts.join("\n").slice(0, 12000);

    if (!this.ai.isConfigured()) {
      return {
        reply: "The AI assistant is not configured yet.",
        degraded: true,
      };
    }

    const result = await this.ai.chat(
      [
        {
          role: "system",
          content: `${persona}\nAnswer using ONLY the website context below. If the answer isn't there, say you don't have that information and offer to connect them with the team. Be concise.\n\n=== WEBSITE CONTEXT ===\n${context}`,
        },
        ...history.slice(-6).map((h) => ({ role: h.role, content: h.content })),
        { role: "user" as const, content: message },
      ],
      {
        maxTokens: 500,
        temperature: 0.4,
        model: (bot.config as any)?.model,
        tenantId: site.tenantId,
      },
    );

    return { reply: result.content };
  }

  async resolveTenantId(tenantSlug?: string): Promise<string> {
    const slug = tenantSlug || "system";
    const tenant = await prisma.tenant.findUnique({
      where: { slug },
      select: { id: true },
    });
    if (!tenant) throw new NotFoundException("Site not found");
    return tenant.id;
  }
}
