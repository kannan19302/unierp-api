import { Injectable, NotFoundException } from "@nestjs/common";

export interface KnowledgeArticle {
  id: string;
  title: string;
  slug: string;
  category: string;
  tags: string[];
  excerpt: string;
  content: string;
  status: "DRAFT" | "PUBLISHED" | "ARCHIVED";
  targetAudience: "OPERATOR" | "TENANT_ADMIN" | "DEVELOPER" | "ALL";
  readTimeMinutes: number;
  version: number;
  author: string;
  views: number;
  publishedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export type LearningModuleType = "ARTICLE" | "VIDEO" | "QUIZ" | "HANDS_ON_LAB";

export interface LearningModule {
  id: string;
  title: string;
  type: LearningModuleType;
  durationMinutes: number;
  contentRef?: string;
  description: string;
  orderIndex: number;
}

export interface LearningPath {
  id: string;
  title: string;
  slug: string;
  description: string;
  targetRole: string;
  totalDurationMinutes: number;
  modules: LearningModule[];
  createdAt: string;
  updatedAt: string;
}

@Injectable()
export class PlatformKnowledgeService {
  private articles: Map<string, KnowledgeArticle> = new Map();
  private learningPaths: Map<string, LearningPath> = new Map();

  constructor() {
    this.seedDefaults();
  }

  private seedDefaults() {
    const defaultArticles: KnowledgeArticle[] = [
      {
        id: "art-101",
        title: "Zero-Downtime Database Migration Runbook",
        slug: "zero-downtime-db-migration",
        category: "OPERATIONS",
        tags: ["database", "postgres", "rls", "migration"],
        excerpt: "Step-by-step procedure for executing expand/contract schema migrations under live traffic.",
        content: `## Expand/Contract Migration Standard\n\n1. **Expand Phase**: Add new nullable columns or tables.\n2. **Backfill Phase**: Asynchronous outbox worker syncs historical records.\n3. **Contract Phase**: Mark legacy columns deprecated, then drop in subsequent release.\n\n\`\`\`sql\nALTER TABLE orders ADD COLUMN IF NOT EXISTS currency_code VARCHAR(3) DEFAULT 'USD';\n\`\`\``,
        status: "PUBLISHED",
        targetAudience: "OPERATOR",
        readTimeMinutes: 6,
        version: 2,
        author: "DevOps Core Team",
        views: 1420,
        publishedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 14).toISOString(),
        createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 30).toISOString(),
        updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 14).toISOString(),
      },
      {
        id: "art-102",
        title: "SAML 2.0 & OIDC Enterprise IdP Integration Guide",
        slug: "enterprise-idp-integration-guide",
        category: "SECURITY",
        tags: ["idp", "saml", "oidc", "sso", "security"],
        excerpt: "Configuring tenant federated authentication with Okta, Azure AD, and PingIdentity.",
        content: `## Identity Federation Walkthrough\n\n- Provide the Entity ID and ACS Callback URL to your IdP administrator.\n- Upload the Identity Provider metadata XML or configure discovery endpoints.\n- Map JIT provisioning attributes: \`email\`, \`givenName\`, \`sn\`, and \`groups\`.\n\n> Note: JIT provisioning requires RBAC role binding verification on first sign-in.`,
        status: "PUBLISHED",
        targetAudience: "TENANT_ADMIN",
        readTimeMinutes: 8,
        version: 1,
        author: "Security & IAM Architecture",
        views: 980,
        publishedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 20).toISOString(),
        createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 25).toISOString(),
        updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 20).toISOString(),
      },
      {
        id: "art-103",
        title: "Developer Webhook Ingestion & Idempotency Best Practices",
        slug: "webhook-ingestion-idempotency",
        category: "INTEGRATION",
        tags: ["webhooks", "api", "idempotency", "architecture"],
        excerpt: "Architectural guidelines for consuming high-throughput webhook events reliably.",
        content: `## Ingestion Standards\n\nAll webhook endpoints MUST:\n1. Verify HMAC SHA-256 signatures with timestamp anti-replay validation.\n2. Return HTTP 202 Accepted within 500ms.\n3. Enqueue event payloads into persistent buffer for worker execution.\n4. Maintain idempotency keys on \`event_id\` to guarantee exactly-once business effects.`,
        status: "DRAFT",
        targetAudience: "DEVELOPER",
        readTimeMinutes: 5,
        version: 1,
        author: "API Platform Team",
        views: 45,
        createdAt: new Date(Date.now() - 1000 * 60 * 60 * 48).toISOString(),
        updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 12).toISOString(),
      },
    ];

    for (const art of defaultArticles) {
      this.articles.set(art.id, art);
    }

    const defaultPaths: LearningPath[] = [
      {
        id: "lp-onboarding",
        title: "Platform Operator Core Certification",
        slug: "platform-operator-certification",
        description: "Foundational training curriculum for enterprise cloud operations and security triage.",
        targetRole: "Cloud Platform Operator",
        totalDurationMinutes: 135,
        modules: [
          {
            id: "mod-1",
            title: "Control Plane Architecture & Security Tenets",
            type: "ARTICLE",
            durationMinutes: 20,
            contentRef: "art-101",
            description: "Deep dive into 14-root architecture, plane isolation, and Zero Standing Privilege.",
            orderIndex: 0,
          },
          {
            id: "mod-2",
            title: "Live Incident Triage & Break-Glass Protocol",
            type: "VIDEO",
            durationMinutes: 35,
            description: "Interactive simulation of break-glass elevation and diagnostic session replay.",
            orderIndex: 1,
          },
          {
            id: "mod-3",
            title: "Automated Runbook Authoring & Execution Lab",
            type: "HANDS_ON_LAB",
            durationMinutes: 50,
            description: "Sandbox exercise: create a live roll-forward rollback runbook with guardrail checks.",
            orderIndex: 2,
          },
          {
            id: "mod-4",
            title: "Operator Certification Assessment",
            type: "QUIZ",
            durationMinutes: 30,
            description: "Comprehensive 25-question audit and troubleshooting exam.",
            orderIndex: 3,
          },
        ],
        createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 10).toISOString(),
        updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 2).toISOString(),
      },
      {
        id: "lp-tenant-admin",
        title: "Tenant Admin Mastery & Compliance",
        slug: "tenant-admin-mastery",
        description: "Onboarding path for enterprise customer workspace administrators.",
        targetRole: "Tenant Administrator",
        totalDurationMinutes: 90,
        modules: [
          {
            id: "mod-10",
            title: "Workspace Security & IdP Federation",
            type: "ARTICLE",
            durationMinutes: 25,
            contentRef: "art-102",
            description: "Step-by-step setup of enterprise SSO and SAML assertion mapping.",
            orderIndex: 0,
          },
          {
            id: "mod-11",
            title: "Compliance Controls & Audit Export",
            type: "HANDS_ON_LAB",
            durationMinutes: 40,
            description: "Scheduling SOC2 and ISO audit reports with immutable hash manifests.",
            orderIndex: 1,
          },
          {
            id: "mod-12",
            title: "Administration Readiness Review",
            type: "QUIZ",
            durationMinutes: 25,
            description: "Knowledge check on privilege delegation and session timeout guards.",
            orderIndex: 2,
          },
        ],
        createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 5).toISOString(),
        updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 1).toISOString(),
      },
    ];

    for (const lp of defaultPaths) {
      this.learningPaths.set(lp.id, lp);
    }
  }

  // ── Article Operations (EC-15.1) ──

  async listArticles(query?: {
    category?: string;
    status?: string;
    search?: string;
    tag?: string;
  }): Promise<KnowledgeArticle[]> {
    let list = Array.from(this.articles.values());

    if (query?.category) {
      list = list.filter((a) => a.category.toUpperCase() === query.category!.toUpperCase());
    }
    if (query?.status) {
      list = list.filter((a) => a.status.toUpperCase() === query.status!.toUpperCase());
    }
    if (query?.tag) {
      list = list.filter((a) => a.tags.some((t) => t.toLowerCase() === query.tag!.toLowerCase()));
    }
    if (query?.search) {
      const s = query.search.toLowerCase();
      list = list.filter(
        (a) =>
          a.title.toLowerCase().includes(s) ||
          a.excerpt.toLowerCase().includes(s) ||
          a.content.toLowerCase().includes(s),
      );
    }

    return list.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }

  async getArticle(id: string): Promise<KnowledgeArticle> {
    const art = this.articles.get(id);
    if (!art) {
      throw new NotFoundException(`Knowledge article "${id}" not found`);
    }
    art.views += 1;
    return art;
  }

  async createArticle(data: {
    title: string;
    slug?: string;
    category?: string;
    tags?: string[];
    excerpt?: string;
    content: string;
    targetAudience?: "OPERATOR" | "TENANT_ADMIN" | "DEVELOPER" | "ALL";
    readTimeMinutes?: number;
    author?: string;
    status?: "DRAFT" | "PUBLISHED";
  }): Promise<KnowledgeArticle> {
    const id = `art-${Date.now().toString(36)}`;
    const slug = data.slug || data.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
    const now = new Date().toISOString();

    const article: KnowledgeArticle = {
      id,
      title: data.title,
      slug,
      category: data.category || "GENERAL",
      tags: data.tags || [],
      excerpt: data.excerpt || data.content.slice(0, 160).replace(/\n/g, " "),
      content: data.content,
      status: data.status || "DRAFT",
      targetAudience: data.targetAudience || "ALL",
      readTimeMinutes: data.readTimeMinutes || Math.max(1, Math.ceil(data.content.split(/\s+/).length / 200)),
      version: 1,
      author: data.author || "Platform Admin",
      views: 0,
      publishedAt: data.status === "PUBLISHED" ? now : undefined,
      createdAt: now,
      updatedAt: now,
    };

    this.articles.set(id, article);
    return article;
  }

  async updateArticle(id: string, updates: Partial<KnowledgeArticle>): Promise<KnowledgeArticle> {
    const art = await this.getArticle(id);
    const updated: KnowledgeArticle = {
      ...art,
      ...updates,
      version: art.version + 1,
      updatedAt: new Date().toISOString(),
    };
    this.articles.set(id, updated);
    return updated;
  }

  async publishArticle(id: string): Promise<KnowledgeArticle> {
    const art = await this.getArticle(id);
    art.status = "PUBLISHED";
    art.publishedAt = new Date().toISOString();
    art.updatedAt = new Date().toISOString();
    this.articles.set(id, art);
    return art;
  }

  async archiveArticle(id: string): Promise<KnowledgeArticle> {
    const art = await this.getArticle(id);
    art.status = "ARCHIVED";
    art.updatedAt = new Date().toISOString();
    this.articles.set(id, art);
    return art;
  }

  async deleteArticle(id: string): Promise<{ success: boolean; id: string }> {
    if (!this.articles.has(id)) {
      throw new NotFoundException(`Knowledge article "${id}" not found`);
    }
    this.articles.delete(id);
    return { success: true, id };
  }

  // ── Learning Path Operations (EC-15.2) ──

  async listLearningPaths(): Promise<LearningPath[]> {
    return Array.from(this.learningPaths.values());
  }

  async getLearningPath(id: string): Promise<LearningPath> {
    const lp = this.learningPaths.get(id);
    if (!lp) {
      throw new NotFoundException(`Learning path "${id}" not found`);
    }
    return lp;
  }

  async createLearningPath(data: {
    title: string;
    description: string;
    targetRole?: string;
    modules?: Omit<LearningModule, "id" | "orderIndex">[];
  }): Promise<LearningPath> {
    const id = `lp-${Date.now().toString(36)}`;
    const slug = data.title.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    const now = new Date().toISOString();

    const modules: LearningModule[] = (data.modules || []).map((m, idx) => ({
      id: `mod-${Date.now().toString(36)}-${idx}`,
      title: m.title,
      type: m.type,
      durationMinutes: m.durationMinutes,
      contentRef: m.contentRef,
      description: m.description,
      orderIndex: idx,
    }));

    const totalDurationMinutes = modules.reduce((sum, m) => sum + m.durationMinutes, 0);

    const path: LearningPath = {
      id,
      title: data.title,
      slug,
      description: data.description,
      targetRole: data.targetRole || "All Platform Roles",
      totalDurationMinutes,
      modules,
      createdAt: now,
      updatedAt: now,
    };

    this.learningPaths.set(id, path);
    return path;
  }

  async reorderModules(pathId: string, orderedModuleIds: string[]): Promise<LearningPath> {
    const path = await this.getLearningPath(pathId);
    const moduleMap = new Map(path.modules.map((m) => [m.id, m]));

    const reordered: LearningModule[] = [];
    orderedModuleIds.forEach((id, index) => {
      const m = moduleMap.get(id);
      if (m) {
        reordered.push({ ...m, orderIndex: index });
        moduleMap.delete(id);
      }
    });

    // Append any modules not explicitly mentioned in the reorder list
    moduleMap.forEach((m) => {
      reordered.push({ ...m, orderIndex: reordered.length });
    });

    path.modules = reordered;
    path.updatedAt = new Date().toISOString();
    this.learningPaths.set(pathId, path);
    return path;
  }

  async getMetrics(): Promise<{
    articlesCount: number;
    publishedArticlesCount: number;
    totalArticleViews: number;
    learningPathsCount: number;
    totalCurriculumMinutes: number;
    adoptionRatePercentage: number;
  }> {
    const articles = Array.from(this.articles.values());
    const paths = Array.from(this.learningPaths.values());

    const published = articles.filter((a) => a.status === "PUBLISHED").length;
    const views = articles.reduce((sum, a) => sum + a.views, 0);
    const totalMinutes = paths.reduce((sum, p) => sum + p.totalDurationMinutes, 0);

    return {
      articlesCount: articles.length,
      publishedArticlesCount: published,
      totalArticleViews: views,
      learningPathsCount: paths.length,
      totalCurriculumMinutes: totalMinutes,
      adoptionRatePercentage: 94.8,
    };
  }
}
