import {
  Injectable, Optional,
  BadRequestException,
  NotFoundException,
} from "@nestjs/common";
import { prisma } from "@kannan19302/database";
import { idpClient as idpPrisma } from "@/common/idp-client";
import { ArtifactRegistryService } from "../platform/artifact-registry.service";
import { ArtifactRevisionsService } from "../platform/artifact-revisions.service";

/**
 * Web Studio content: pages, blog posts, assets, templates, menus, SEO configs,
 * and global web settings. Straightforward per-tenant CRUD with no cross-domain
 * dependencies.
 */
@Injectable()
export class BuilderWebContentService {
  constructor(@Optional() private readonly artifacts?: ArtifactRegistryService, @Optional() private readonly revisions?: ArtifactRevisionsService) {}

  private async mirrorBlogPost(tenantId: string, post: any) {
    const artifact = await this.artifacts?.record({ tenantId, artifactType: "BLOG_POST", artifactId: post.id, name: post.title, slug: post.slug, status: post.status === "PUBLISHED" ? "PUBLISHED" : "DRAFT" });
    if (!artifact || !this.revisions) return;
    await this.revisions.syncLegacyProjection({ tenantId, artifactId: artifact.id, scope: { kind: "LIBRARY" }, createdBy: post.createdBy ?? null, source: {
      apiVersion: "unierp.dev/v1", kind: "BLOG_POST", metadata: { id: artifact.id, namespace: `tenant.${tenantId}`, name: post.title, description: post.excerpt ?? undefined },
      spec: { slug: post.slug, content: post.content ?? null, category: post.category ?? null, tags: post.tags ?? [], author: post.author ?? null, featuredImage: post.featuredImage ?? null, metaTitle: post.metaTitle ?? null, metaDesc: post.metaDesc ?? null, readTime: post.readTime ?? null },
      interfaces: { inputs: [], outputs: [], events: [] }, dependencies: [], capabilities: [], tests: [], extensions: { legacyProjection: { table: "blog_posts", id: post.id } },
    } });
  }

  private async mirrorWebAsset(tenantId: string, asset: any) {
    const slug = `asset-${String(asset.name ?? asset.id).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || asset.id}`;
    const artifact = await this.artifacts?.record({ tenantId, artifactType: "ASSET", artifactId: asset.id, name: asset.name, slug, status: asset.status === "ACTIVE" ? "PUBLISHED" : "DRAFT" });
    if (!artifact || !this.revisions) return;
    await this.revisions.syncLegacyProjection({ tenantId, artifactId: artifact.id, scope: { kind: "LIBRARY" }, createdBy: asset.createdBy ?? null, source: {
      apiVersion: "unierp.dev/v1", kind: "ASSET", metadata: { id: artifact.id, namespace: `tenant.${tenantId}`, name: asset.name },
      spec: { url: asset.url, type: asset.type, sizeBytes: asset.sizeBytes ?? 0 }, interfaces: { inputs: [], outputs: [], events: [] }, dependencies: [], capabilities: [], tests: [], extensions: { legacyProjection: { table: "web_assets", id: asset.id } },
    } });
  }

  private async mirrorWebMenu(tenantId: string, menu: any) {
    const slug = `menu-${String(menu.location ?? "default").toLowerCase()}-${menu.id}`;
    const artifact = await this.artifacts?.record({ tenantId, artifactType: "MENU", artifactId: menu.id, name: menu.name, slug, status: menu.status === "ACTIVE" ? "PUBLISHED" : "DRAFT" });
    if (!artifact || !this.revisions) return;
    await this.revisions.syncLegacyProjection({ tenantId, artifactId: artifact.id, scope: { kind: "LIBRARY" }, createdBy: menu.createdBy ?? null, source: {
      apiVersion: "unierp.dev/v1", kind: "MENU", metadata: { id: artifact.id, namespace: `tenant.${tenantId}`, name: menu.name },
      spec: { location: menu.location, items: menu.items ?? [] }, interfaces: { inputs: [], outputs: [], events: [] }, dependencies: [], capabilities: [], tests: [], extensions: { legacyProjection: { table: "web_menus", id: menu.id } },
    } });
  }

  private async mirrorSeoProfile(tenantId: string, seo: any) {
    const slug = `seo-${String(seo.path ?? seo.id).replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "") || seo.id}`;
    const artifact = await this.artifacts?.record({ tenantId, artifactType: "SEO_PROFILE", artifactId: seo.id, name: seo.title, slug, status: seo.status === "ACTIVE" ? "PUBLISHED" : "DRAFT" });
    if (!artifact || !this.revisions) return;
    await this.revisions.syncLegacyProjection({ tenantId, artifactId: artifact.id, scope: { kind: "LIBRARY" }, createdBy: seo.createdBy ?? null, source: {
      apiVersion: "unierp.dev/v1", kind: "SEO_PROFILE", metadata: { id: artifact.id, namespace: `tenant.${tenantId}`, name: seo.title },
      spec: { path: seo.path, title: seo.title, description: seo.description ?? null, keywords: seo.keywords ?? null, ogImage: seo.ogImage ?? null }, interfaces: { inputs: [], outputs: [], events: [] }, dependencies: [], capabilities: [], tests: [], extensions: { legacyProjection: { table: "web_seo", id: seo.id } },
    } });
  }

  // ── WEB PAGES ─────────────────────────────────
  //
  // P7: `web_pages` was migrated into `web_site_pages` and dropped. These
  // routes are deprecated (see the deprecation registry) but must keep their
  // exact request/response shape until they are removed, so everything below
  // translates between the legacy vocabulary and the multi-site one:
  //
  //   name       <-> title
  //   slug       <-> path        ("about" <-> "/about", "" <-> "/")
  //   sections   <-> blocks
  //   metaTitle/metaDesc/ogImage <-> seo{...}
  //   visibility  -> seo.legacyVisibility
  //
  // `visibility` has no column on WebSitePage. Rather than drop it (silently
  // losing a field callers still send) it rides in the seo blob under a
  // clearly-named key, so a round-trip through these routes is lossless.

  /** The tenant's default site — the one legacy pages were migrated onto. */
  private async defaultSiteId(tenantId: string): Promise<string> {
    const site = await prisma.webSite.findFirst({
      where: { tenantId, slug: "default" },
      select: { id: true },
    });
    if (site) return site.id;
    const created = await prisma.webSite.create({
      data: { tenantId, name: "Default Site", slug: "default" },
      select: { id: true },
    });
    return created.id;
  }

  private slugToPath(slug: string): string {
    if (!slug || ["home", "index"].includes(slug)) return "/";
    return slug.startsWith("/") ? slug : `/${slug}`;
  }

  private pathToSlug(path: string): string {
    return path === "/" ? "home" : path.replace(/^\//, "");
  }

  /** Presents a WebSitePage row in the legacy WebPage shape. */
  private toLegacyPage(row: {
    id: string;
    tenantId: string;
    title: string;
    path: string;
    blocks: unknown;
    seo: unknown;
    status: string;
    sortOrder: number;
    createdAt: Date;
    updatedAt: Date;
  }) {
    const seo = (row.seo ?? {}) as Record<string, unknown>;
    return {
      id: row.id,
      tenantId: row.tenantId,
      name: row.title,
      slug: this.pathToSlug(row.path),
      status: row.status,
      sections: row.blocks ?? [],
      metaTitle: (seo.metaTitle as string) ?? null,
      metaDesc: (seo.metaDesc as string) ?? null,
      ogImage: (seo.ogImage as string) ?? null,
      visibility: (seo.legacyVisibility as string) ?? "PUBLIC",
      sortOrder: row.sortOrder,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  async getWebPages(tenantId: string) {
    const siteId = await this.defaultSiteId(tenantId);
    const rows = await prisma.webSitePage.findMany({
      where: { tenantId, siteId },
      orderBy: { sortOrder: "asc" },
    });
    return rows.map((r) => this.toLegacyPage(r));
  }

  async getWebPageById(tenantId: string, id: string) {
    const page = await prisma.webSitePage.findFirst({ where: { id, tenantId } });
    if (!page) throw new NotFoundException("Web page not found");
    return this.toLegacyPage(page);
  }

  async createWebPage(
    tenantId: string,
    dto: {
      name: string;
      slug: string;
      sections?: any;
      metaTitle?: string;
      metaDesc?: string;
      ogImage?: string;
      visibility?: string;
    },
  ) {
    const siteId = await this.defaultSiteId(tenantId);
    const path = this.slugToPath(dto.slug);

    const existing = await prisma.webSitePage.findFirst({
      where: { siteId, path },
    });
    if (existing)
      throw new BadRequestException("A page with this slug already exists");

    const created = await prisma.webSitePage.create({
      data: {
        tenantId,
        siteId,
        title: dto.name,
        path,
        type: "PAGE",
        blocks: dto.sections || [],
        seo: {
          metaTitle: dto.metaTitle || null,
          metaDesc: dto.metaDesc || null,
          ogImage: dto.ogImage || null,
          legacyVisibility: dto.visibility || "PUBLIC",
        },
      },
    });
    return this.toLegacyPage(created);
  }

  async updateWebPage(
    tenantId: string,
    id: string,
    dto: Partial<{
      name: string;
      slug: string;
      status: string;
      sections: any;
      metaTitle: string;
      metaDesc: string;
      ogImage: string;
      visibility: string;
      sortOrder: number;
    }>,
  ) {
    const page = await prisma.webSitePage.findFirst({ where: { id, tenantId } });
    if (!page) throw new NotFoundException("Web page not found");

    // Merge into the existing seo blob rather than replacing it, so updating
    // one meta field does not clear the others.
    const seo = { ...((page.seo ?? {}) as Record<string, unknown>) };
    if (dto.metaTitle !== undefined) seo.metaTitle = dto.metaTitle;
    if (dto.metaDesc !== undefined) seo.metaDesc = dto.metaDesc;
    if (dto.ogImage !== undefined) seo.ogImage = dto.ogImage;
    if (dto.visibility !== undefined) seo.legacyVisibility = dto.visibility;

    const updated = await prisma.webSitePage.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { title: dto.name }),
        ...(dto.slug !== undefined && { path: this.slugToPath(dto.slug) }),
        ...(dto.status !== undefined && { status: dto.status }),
        ...(dto.sections !== undefined && { blocks: dto.sections }),
        ...(dto.sortOrder !== undefined && { sortOrder: dto.sortOrder }),
        seo: seo as never,
      },
    });
    return this.toLegacyPage(updated);
  }

  async deleteWebPage(tenantId: string, id: string) {
    const page = await prisma.webSitePage.findFirst({ where: { id, tenantId } });
    if (!page) throw new NotFoundException("Web page not found");
    return prisma.webSitePage.delete({ where: { id } });
  }

  // ── BLOG POSTS ────────────────────────────────
  async getBlogPosts(tenantId: string) {
    return prisma.blogPost.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
    });
  }

  async getBlogPostById(tenantId: string, id: string) {
    const post = await prisma.blogPost.findFirst({ where: { id, tenantId } });
    if (!post) throw new NotFoundException("Blog post not found");
    return post;
  }

  async createBlogPost(
    tenantId: string,
    dto: {
      title: string;
      slug: string;
      content?: string;
      excerpt?: string;
      category?: string;
      tags?: any;
      author?: string;
      featuredImage?: string;
      metaTitle?: string;
      metaDesc?: string;
      readTime?: string;
    },
  ) {
    const existing = await prisma.blogPost.findFirst({
      where: { tenantId, slug: dto.slug },
    });
    if (existing)
      throw new BadRequestException(
        "A blog post with this slug already exists",
      );

    const post = await prisma.blogPost.create({
      data: {
        tenantId,
        title: dto.title,
        slug: dto.slug,
        content: dto.content || null,
        excerpt: dto.excerpt || null,
        category: dto.category || "General",
        tags: dto.tags || [],
        author: dto.author || null,
        featuredImage: dto.featuredImage || null,
        metaTitle: dto.metaTitle || null,
        metaDesc: dto.metaDesc || null,
        readTime: dto.readTime || null,
      },
    });
    await this.mirrorBlogPost(tenantId, post);
    return post;
  }

  async updateBlogPost(
    tenantId: string,
    id: string,
    dto: Partial<{
      title: string;
      content: string;
      excerpt: string;
      category: string;
      tags: any;
      author: string;
      status: string;
      featuredImage: string;
      metaTitle: string;
      metaDesc: string;
      readTime: string;
    }>,
  ) {
    const post = await prisma.blogPost.findFirst({ where: { id, tenantId } });
    if (!post) throw new NotFoundException("Blog post not found");

    const updated = await prisma.blogPost.update({
      where: { id },
      data: {
        ...(dto.title !== undefined && { title: dto.title }),
        ...(dto.content !== undefined && { content: dto.content }),
        ...(dto.excerpt !== undefined && { excerpt: dto.excerpt }),
        ...(dto.category !== undefined && { category: dto.category }),
        ...(dto.tags !== undefined && { tags: dto.tags }),
        ...(dto.author !== undefined && { author: dto.author }),
        ...(dto.status !== undefined && { status: dto.status }),
        ...(dto.featuredImage !== undefined && {
          featuredImage: dto.featuredImage,
        }),
        ...(dto.metaTitle !== undefined && { metaTitle: dto.metaTitle }),
        ...(dto.metaDesc !== undefined && { metaDesc: dto.metaDesc }),
        ...(dto.readTime !== undefined && { readTime: dto.readTime }),
        ...(dto.status === "PUBLISHED" &&
          !post.publishedAt && { publishedAt: new Date() }),
      },
    });
    await this.mirrorBlogPost(tenantId, updated);
    return updated;
  }

  async deleteBlogPost(tenantId: string, id: string) {
    const post = await prisma.blogPost.findFirst({ where: { id, tenantId } });
    if (!post) throw new NotFoundException("Blog post not found");
    const deleted = await prisma.blogPost.delete({ where: { id } });
    await this.artifacts?.retire(tenantId, "BLOG_POST", id);
    return deleted;
  }

  // ── WEB ASSETS ────────────────────────────────
  async getWebAssets(tenantId: string) {
    return prisma.webAsset.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
    });
  }

  async createWebAsset(
    tenantId: string,
    dto: { name: string; url: string; type?: string; sizeBytes?: number },
  ) {
    const asset = await prisma.webAsset.create({
      data: {
        tenantId,
        name: dto.name,
        url: dto.url,
        type: dto.type || "IMAGE",
        sizeBytes: dto.sizeBytes || 0,
      },
    });
    await this.mirrorWebAsset(tenantId, asset);
    return asset;
  }

  async updateWebAsset(
    tenantId: string,
    id: string,
    dto: Partial<{ name: string; url: string; type: string }>,
  ) {
    const asset = await prisma.webAsset.findFirst({ where: { id, tenantId } });
    if (!asset) throw new NotFoundException("Web asset not found");
    const updated = await prisma.webAsset.update({
      where: { id },
      data: dto,
    });
    await this.mirrorWebAsset(tenantId, updated);
    return updated;
  }

  async deleteWebAsset(tenantId: string, id: string) {
    const asset = await prisma.webAsset.findFirst({ where: { id, tenantId } });
    if (!asset) throw new NotFoundException("Web asset not found");
    const deleted = await prisma.webAsset.delete({ where: { id } });
    await this.artifacts?.retire(tenantId, "ASSET", id);
    return deleted;
  }

  // ── WEB TEMPLATES ─────────────────────────────
  async getWebTemplates(tenantId: string) {
    return prisma.webTemplate.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
    });
  }

  async createWebTemplate(
    tenantId: string,
    dto: {
      name: string;
      description?: string;
      htmlContent?: string;
      cssContent?: string;
      status?: string;
    },
  ) {
    return prisma.webTemplate.create({
      data: {
        tenantId,
        name: dto.name,
        description: dto.description || null,
        htmlContent: dto.htmlContent || null,
        cssContent: dto.cssContent || null,
        status: dto.status || "DRAFT",
      },
    });
  }

  async updateWebTemplate(
    tenantId: string,
    id: string,
    dto: Partial<{
      name: string;
      description: string;
      htmlContent: string;
      cssContent: string;
      status: string;
    }>,
  ) {
    const template = await prisma.webTemplate.findFirst({
      where: { id, tenantId },
    });
    if (!template) throw new NotFoundException("Web template not found");
    return prisma.webTemplate.update({
      where: { id },
      data: dto,
    });
  }

  async deleteWebTemplate(tenantId: string, id: string) {
    const template = await prisma.webTemplate.findFirst({
      where: { id, tenantId },
    });
    if (!template) throw new NotFoundException("Web template not found");
    return prisma.webTemplate.delete({ where: { id } });
  }

  // ── WEB MENUS ─────────────────────────────────
  async getWebMenus(tenantId: string) {
    return prisma.webMenu.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
    });
  }

  async createWebMenu(
    tenantId: string,
    dto: { name: string; location?: string; items?: any; status?: string },
  ) {
    const menu = await prisma.webMenu.create({
      data: {
        tenantId,
        name: dto.name,
        location: dto.location || "HEADER",
        items: dto.items || [],
        status: dto.status || "ACTIVE",
      },
    });
    await this.mirrorWebMenu(tenantId, menu);
    return menu;
  }

  async updateWebMenu(
    tenantId: string,
    id: string,
    dto: Partial<{
      name: string;
      location: string;
      items: any;
      status: string;
    }>,
  ) {
    const menu = await prisma.webMenu.findFirst({ where: { id, tenantId } });
    if (!menu) throw new NotFoundException("Web menu not found");
    const updated = await prisma.webMenu.update({
      where: { id },
      data: dto,
    });
    await this.mirrorWebMenu(tenantId, updated);
    return updated;
  }

  async deleteWebMenu(tenantId: string, id: string) {
    const menu = await prisma.webMenu.findFirst({ where: { id, tenantId } });
    if (!menu) throw new NotFoundException("Web menu not found");
    const deleted = await prisma.webMenu.delete({ where: { id } });
    await this.artifacts?.retire(tenantId, "MENU", id);
    return deleted;
  }

  // ── WEB SEO ───────────────────────────────────
  async getWebSeo(tenantId: string) {
    return prisma.webSeo.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
    });
  }

  async createWebSeo(
    tenantId: string,
    dto: {
      path: string;
      title: string;
      description?: string;
      keywords?: string;
      ogImage?: string;
      status?: string;
    },
  ) {
    const existing = await prisma.webSeo.findFirst({
      where: { tenantId, path: dto.path },
    });
    if (existing)
      throw new BadRequestException("SEO config for this path already exists");
    const seo = await prisma.webSeo.create({
      data: {
        tenantId,
        path: dto.path,
        title: dto.title,
        description: dto.description || null,
        keywords: dto.keywords || null,
        ogImage: dto.ogImage || null,
        status: dto.status || "ACTIVE",
      },
    });
    await this.mirrorSeoProfile(tenantId, seo);
    return seo;
  }

  async updateWebSeo(
    tenantId: string,
    id: string,
    dto: Partial<{
      path: string;
      title: string;
      description: string;
      keywords: string;
      ogImage: string;
      status: string;
    }>,
  ) {
    const seo = await prisma.webSeo.findFirst({ where: { id, tenantId } });
    if (!seo) throw new NotFoundException("Web SEO not found");
    const updated = await prisma.webSeo.update({
      where: { id },
      data: dto,
    });
    await this.mirrorSeoProfile(tenantId, updated);
    return updated;
  }

  async deleteWebSeo(tenantId: string, id: string) {
    const seo = await prisma.webSeo.findFirst({ where: { id, tenantId } });
    if (!seo) throw new NotFoundException("Web SEO not found");
    const deleted = await prisma.webSeo.delete({ where: { id } });
    await this.artifacts?.retire(tenantId, "SEO_PROFILE", id);
    return deleted;
  }

  // ── WEB SETTINGS ──────────────────────────────
  async getWebSettings(tenantId: string) {
    let settings = await prisma.webSettings.findFirst({ where: { tenantId } });
    if (!settings) {
      settings = await prisma.webSettings.create({ data: { tenantId } });
    }
    return settings;
  }

  async updateWebSettings(tenantId: string, data: any) {
    const settings = await this.getWebSettings(tenantId);
    return prisma.webSettings.update({
      where: { id: settings.id },
      data: {
        activeTemplateId:
          data.activeTemplateId !== undefined
            ? data.activeTemplateId
            : undefined,
        globalCss: data.globalCss !== undefined ? data.globalCss : undefined,
        themeTokens:
          data.themeTokens !== undefined ? data.themeTokens : undefined,
      },
    });
  }
}
