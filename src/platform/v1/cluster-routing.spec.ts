import { describe, it, expect, beforeEach, vi } from "vitest";
import { SaasClusterRoutingDeepService } from "./cluster-routing.service";
import { SaasClusterRoutingDeepController } from "./cluster-routing.controller";

describe("SaasClusterRoutingDeep (PCC-08 API Traffic Control)", () => {
  let service: SaasClusterRoutingDeepService;
  let controller: SaasClusterRoutingDeepController;

  beforeEach(() => {
    service = new SaasClusterRoutingDeepService();
    controller = new SaasClusterRoutingDeepController(service);
  });

  describe("Cluster Management", () => {
    it("returns multi-tenant clusters", async () => {
      const clusters = await controller.getClusters();
      expect(Array.isArray(clusters)).toBe(true);
    });

    it("creates a multi-tenant cluster", async () => {
      const created = await controller.createCluster({
        clusterName: "test-cluster-us-east",
        region: "us-east-1",
        provider: "AWS",
        endpoint: "https://k8s-us-east.unierp.internal",
        maxTenants: 1000,
      });
      expect(created).toBeDefined();
    });
  });

  describe("Rate Limit Rule Builder", () => {
    it("lists default rate limit rules", async () => {
      const rules = await controller.getRateLimitRules();
      expect(rules.length).toBeGreaterThanOrEqual(4);
      expect(rules.some((r) => r.endpointPath === "/api/v1/*")).toBe(true);
      expect(rules.some((r) => r.endpointPath === "/api/v1/auth/*")).toBe(true);
    });

    it("creates a new rate limit rule", async () => {
      const newRule = await controller.createRateLimitRule({
        name: "Enterprise Bulk Export Limits",
        endpointPath: "/api/v1/exports/*",
        limitPerMinute: 20,
        burstLimit: 40,
        clientTier: "ENTERPRISE",
        tenantId: "acme-tenant",
        isActive: true,
      });

      expect(newRule.name).toBe("Enterprise Bulk Export Limits");
      expect(newRule.endpointPath).toBe("/api/v1/exports/*");
      expect(newRule.limitPerMinute).toBe(20);

      const all = await controller.getRateLimitRules();
      expect(all.some((r) => r.name === "Enterprise Bulk Export Limits")).toBe(true);
    });

    it("updates an existing rate limit rule", async () => {
      const created = await controller.createRateLimitRule({
        name: "Temporary Throttle",
        endpointPath: "/api/v1/temp/*",
        limitPerMinute: 10,
        burstLimit: 15,
      });

      const updated = await controller.updateRateLimitRule(created.id!, {
        limitPerMinute: 30,
        burstLimit: 60,
      });

      expect(updated.limitPerMinute).toBe(30);
      expect(updated.burstLimit).toBe(60);
    });

    it("deletes a rate limit rule", async () => {
      const created = await controller.createRateLimitRule({
        name: "To Delete",
        endpointPath: "/api/v1/delete-me/*",
        limitPerMinute: 5,
      });

      const res = await controller.deleteRateLimitRule(created.id!);
      expect(res.success).toBe(true);
      expect(res.id).toBe(created.id);
    });
  });

  describe("API Deprecation Timeline", () => {
    it("retrieves the RFC 9745 deprecation registry entries", async () => {
      const deprecations = await controller.getDeprecations();
      expect(deprecations.length).toBeGreaterThanOrEqual(3);
      expect(deprecations[0]).toHaveProperty("pathPrefix");
      expect(deprecations[0]).toHaveProperty("deprecatedAt");
      expect(deprecations[0]).toHaveProperty("successor");
      expect(deprecations[0]).toHaveProperty("activeConsumers");
      expect(deprecations[0]).toHaveProperty("status");
    });

    it("dispatches sunset notification to affected consumers", async () => {
      const result = await controller.notifySunset("dep-1");
      expect(result.success).toBe(true);
      expect(result.ruleId).toBe("dep-1");
      expect(result.channels).toContain("EMAIL");
      expect(result.channels).toContain("WEBHOOK");
      expect(result.recipientsCount).toBeGreaterThan(0);
    });
  });

  describe("Traffic Stats & WAF Security", () => {
    it("returns aggregated gateway traffic metrics", async () => {
      const stats = await controller.getTrafficStats();
      expect(stats.gatewayRoutes).toBeGreaterThan(0);
      expect(stats.p99LatencyMs).toBe(48);
      expect(stats.wafFilterRate).toBe("99.99%");
      expect(stats.healthStatus).toBe("HEALTHY");
    });

    it("lists active WAF rules", async () => {
      const rules = await controller.getWafRules();
      expect(rules.length).toBeGreaterThanOrEqual(4);
      expect(rules.some((r) => r.action === "BLOCK")).toBe(true);
    });

    it("deploys a new WAF security rule", async () => {
      const waf = await controller.createWafRule({
        name: "GraphQL Query Complexity Guard",
        action: "BLOCK",
        pattern: "depth > 6 || complexity > 250",
        priority: 5,
        enabled: true,
      });

      expect(waf.name).toBe("GraphQL Query Complexity Guard");
      expect(waf.action).toBe("BLOCK");
      expect(waf.enabled).toBe(true);
    });
  });
});
