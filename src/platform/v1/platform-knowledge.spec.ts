/**
 * Unit tests for PlatformKnowledgeService & PlatformKnowledgeController (PCC-15)
 *
 * Verifies:
 * - EC-15.1: Article editor creates, updates, and publishes rich text articles with tags and audience targeting
 * - EC-15.2: Learning path builder manages ordered modules, re-orders them, and computes curriculum durations
 * - Platform adoption and curriculum metrics
 */
import { describe, it, expect, beforeEach } from "vitest";
import { PlatformKnowledgeService } from "./platform-knowledge.service";

describe("PlatformKnowledgeService (PCC-15)", () => {
  let service: PlatformKnowledgeService;

  beforeEach(() => {
    service = new PlatformKnowledgeService();
  });

  describe("EC-15.1: Knowledge Article Editor & Lifecycle", () => {
    it("lists default seed articles and filters by category and status", async () => {
      const articles = await service.listArticles();
      expect(articles.length).toBeGreaterThanOrEqual(3);

      const opsArticles = await service.listArticles({ category: "OPERATIONS" });
      expect(opsArticles.length).toBeGreaterThanOrEqual(1);
      expect(opsArticles[0].category).toBe("OPERATIONS");

      const draftArticles = await service.listArticles({ status: "DRAFT" });
      expect(draftArticles.length).toBeGreaterThanOrEqual(1);
      expect(draftArticles[0].status).toBe("DRAFT");
    });

    it("creates a new rich text knowledge article in DRAFT status", async () => {
      const article = await service.createArticle({
        title: "Disaster Recovery Failover Procedure (RTO < 15m)",
        category: "OPERATIONS",
        tags: ["disaster-recovery", "failover", "aurora", "rto"],
        excerpt: "Operational runbook for triggering automated cross-region database failover.",
        content: "## Failover Execution Checklist\n\n1. Verify primary cluster status.\n2. Promote secondary replica.\n3. Update Route53 CNAME.",
        targetAudience: "OPERATOR",
        author: "DevOps SRE",
        status: "DRAFT",
      });

      expect(article.id).toBeDefined();
      expect(article.title).toBe("Disaster Recovery Failover Procedure (RTO < 15m)");
      expect(article.status).toBe("DRAFT");
      expect(article.tags).toContain("disaster-recovery");
      expect(article.version).toBe(1);

      const fetched = await service.getArticle(article.id);
      expect(fetched.title).toBe(article.title);
      expect(fetched.views).toBe(1); // view count incremented
    });

    it("publishes an article, transitioning status to PUBLISHED with publishedAt timestamp", async () => {
      const article = await service.createArticle({
        title: "Customer Sandbox Provisioning SOP",
        content: "Procedure for spinning up isolated tenant staging environments.",
        status: "DRAFT",
      });
      expect(article.status).toBe("DRAFT");
      expect(article.publishedAt).toBeUndefined();

      const published = await service.publishArticle(article.id);
      expect(published.status).toBe("PUBLISHED");
      expect(published.publishedAt).toBeDefined();
    });

    it("archives an article, moving it out of active view", async () => {
      const articles = await service.listArticles();
      const target = articles[0];

      const archived = await service.archiveArticle(target.id);
      expect(archived.status).toBe("ARCHIVED");
    });

    it("searches articles by keywords matching title or body content", async () => {
      const results = await service.listArticles({ search: "SAML" });
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].title).toContain("SAML");
    });
  });

  describe("EC-15.2: Learning Path Builder & Module Ordering", () => {
    it("lists default onboarding and training curricula", async () => {
      const paths = await service.listLearningPaths();
      expect(paths.length).toBeGreaterThanOrEqual(2);
      expect(paths[0].modules.length).toBeGreaterThanOrEqual(3);
    });

    it("creates a new learning path with ordered module sequence", async () => {
      const path = await service.createLearningPath({
        title: "Enterprise FinOps & Cloud Billing Specialist",
        description: "Mastery curriculum for billing operators and revenue auditors.",
        targetRole: "FinOps Analyst",
        modules: [
          {
            title: "Understanding Margin & Cost Allocation",
            type: "ARTICLE",
            durationMinutes: 20,
            description: "Study allocation rules and tenant cost attribution.",
          },
          {
            title: "Building Custom Margin Dashboards",
            type: "HANDS_ON_LAB",
            durationMinutes: 45,
            description: "Construct executive KPI dashboards in Platform Intelligence.",
          },
          {
            title: "FinOps Certification Exam",
            type: "QUIZ",
            durationMinutes: 25,
            description: "Final exam covering unit economics and pricing tiers.",
          },
        ],
      });

      expect(path.id).toBeDefined();
      expect(path.title).toBe("Enterprise FinOps & Cloud Billing Specialist");
      expect(path.modules).toHaveLength(3);
      expect(path.totalDurationMinutes).toBe(90);
      expect(path.modules[0].orderIndex).toBe(0);
      expect(path.modules[1].orderIndex).toBe(1);
      expect(path.modules[2].orderIndex).toBe(2);
    });

    it("reorders modules in a learning path correctly", async () => {
      const paths = await service.listLearningPaths();
      const target = paths[0];
      const initialModules = target.modules;
      expect(initialModules.length).toBeGreaterThanOrEqual(3);

      const reversedIds = [...initialModules].reverse().map((m) => m.id);
      const reorderedPath = await service.reorderModules(target.id, reversedIds);

      expect(reorderedPath.modules[0].id).toBe(reversedIds[0]);
      expect(reorderedPath.modules[0].orderIndex).toBe(0);
      expect(reorderedPath.modules[reorderedPath.modules.length - 1].id).toBe(
        reversedIds[reversedIds.length - 1],
      );
    });
  });

  describe("Platform Adoption Metrics", () => {
    it("returns platform knowledge repository and curriculum adoption metrics", async () => {
      const metrics = await service.getMetrics();
      expect(metrics.articlesCount).toBeGreaterThanOrEqual(3);
      expect(metrics.publishedArticlesCount).toBeGreaterThanOrEqual(2);
      expect(metrics.learningPathsCount).toBeGreaterThanOrEqual(2);
      expect(metrics.totalCurriculumMinutes).toBeGreaterThan(100);
      expect(metrics.adoptionRatePercentage).toBeGreaterThan(90);
    });
  });
});
