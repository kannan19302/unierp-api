import { describe, it, expect, beforeEach } from "vitest";
import { OrganizationEntitlementsService } from "../services/organization-entitlements.service";

describe("OrganizationEntitlementsService (OCC-09)", () => {
  let service: OrganizationEntitlementsService;
  const tenantId = "tenant-test-123";

  beforeEach(() => {
    service = new OrganizationEntitlementsService();
  });

  it("returns organization entitlement capacity summary", async () => {
    const summary = await service.getSummary(tenantId);
    expect(summary.planEdition).toBe("Enterprise Plus");
    expect(summary.totalSeats).toBe(150);
    expect(summary.allocatedSeats).toBe(2);
    expect(summary.availableSeats).toBe(148);
    expect(summary.entitlements.length).toBeGreaterThanOrEqual(4);
  });

  it("allocates member license seats with specific entitlement bundles", async () => {
    const alloc = await service.allocateLicense(tenantId, {
      userId: "usr-99",
      userName: "Taylor Smith",
      userEmail: "taylor.smith@example.com",
      department: "Legal",
      entitlements: ["core-erp", "multi-entity"],
    });
    expect(alloc.userId).toBe("usr-99");
    expect(alloc.status).toBe("ACTIVE");
    expect(alloc.assignedEntitlements).toContain("multi-entity");

    const all = await service.listAllocations(tenantId);
    expect(all.some((a) => a.userId === "usr-99")).toBe(true);
  });

  it("reclaims license allocation from an inactive member", async () => {
    const reclaimed = await service.reclaimLicense(tenantId, "alc-101");
    expect(reclaimed.status).toBe("INACTIVE");
    expect(reclaimed.assignedEntitlements).toHaveLength(0);
  });

  it("creates and lists auto-assignment rules by department or role", async () => {
    const rule = await service.saveAssignmentRule(tenantId, {
      name: "Engineering Standard User",
      targetType: "DEPARTMENT",
      targetValue: "Engineering",
      entitlementCodes: ["core-erp", "api-gateway"],
    });
    expect(rule.name).toBe("Engineering Standard User");
    expect(rule.enabled).toBe(true);

    const rules = await service.listAssignmentRules(tenantId);
    expect(rules.some((r) => r.name === "Engineering Standard User")).toBe(true);
  });
});
