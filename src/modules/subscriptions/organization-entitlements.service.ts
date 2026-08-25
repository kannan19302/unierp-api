import { Injectable } from "@nestjs/common";

export interface EntitlementItem {
  id: string;
  name: string;
  code: string;
  type: "SEAT_BASED" | "FEATURE_FLAG" | "USAGE_QUOTA";
  totalQuota: number | "UNLIMITED";
  allocated: number;
  available: number | "UNLIMITED";
  unit: string;
}

export interface LicenseAllocation {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  department: string;
  assignedEntitlements: string[];
  allocatedAt: string;
  lastActiveAt: string;
  status: "ACTIVE" | "INACTIVE" | "RESERVED";
}

export interface EntitlementAssignmentRule {
  id: string;
  name: string;
  targetType: "DEPARTMENT" | "ROLE";
  targetValue: string;
  entitlementCodes: string[];
  priority: number;
  enabled: boolean;
}

@Injectable()
export class OrganizationEntitlementsService {
  private entitlements: Record<string, EntitlementItem[]> = {};
  private allocations: Record<string, LicenseAllocation[]> = {};
  private rules: Record<string, EntitlementAssignmentRule[]> = {};

  private initTenant(tenantId: string) {
    if (!this.entitlements[tenantId]) {
      this.entitlements[tenantId] = [
        {
          id: "ent-1",
          name: "Core ERP Standard User",
          code: "core-erp",
          type: "SEAT_BASED",
          totalQuota: 150,
          allocated: 112,
          available: 38,
          unit: "seats",
        },
        {
          id: "ent-2",
          name: "AI Copilot & Autonomous Agents",
          code: "ai-copilot",
          type: "SEAT_BASED",
          totalQuota: 50,
          allocated: 42,
          available: 8,
          unit: "seats",
        },
        {
          id: "ent-3",
          name: "Advanced Financial Analytics",
          code: "advanced-analytics",
          type: "SEAT_BASED",
          totalQuota: 75,
          allocated: 60,
          available: 15,
          unit: "seats",
        },
        {
          id: "ent-4",
          name: "Multi-Entity Consolidation",
          code: "multi-entity",
          type: "FEATURE_FLAG",
          totalQuota: "UNLIMITED",
          allocated: 1,
          available: "UNLIMITED",
          unit: "tenant-wide",
        },
        {
          id: "ent-5",
          name: "Custom Integration Webhooks & API Gateway",
          code: "api-gateway",
          type: "USAGE_QUOTA",
          totalQuota: 500_000,
          allocated: 184_200,
          available: 315_800,
          unit: "requests/mo",
        },
      ];
    }

    if (!this.allocations[tenantId]) {
      this.allocations[tenantId] = [
        {
          id: "alc-101",
          userId: "usr-01",
          userName: "Sarah Jenkins",
          userEmail: "s.jenkins@acme-corp.com",
          department: "Finance",
          assignedEntitlements: ["core-erp", "ai-copilot", "advanced-analytics"],
          allocatedAt: new Date(Date.now() - 3600_000 * 24 * 30).toISOString(),
          lastActiveAt: new Date(Date.now() - 60_000 * 15).toISOString(),
          status: "ACTIVE",
        },
        {
          id: "alc-102",
          userId: "usr-02",
          userName: "David Chen",
          userEmail: "d.chen@acme-corp.com",
          department: "Operations",
          assignedEntitlements: ["core-erp", "ai-copilot"],
          allocatedAt: new Date(Date.now() - 3600_000 * 24 * 14).toISOString(),
          lastActiveAt: new Date(Date.now() - 3600_000 * 2).toISOString(),
          status: "ACTIVE",
        },
        {
          id: "alc-103",
          userId: "usr-03",
          userName: "Elena Rostova",
          userEmail: "e.rostova@acme-corp.com",
          department: "Supply Chain",
          assignedEntitlements: ["core-erp"],
          allocatedAt: new Date(Date.now() - 3600_000 * 24 * 45).toISOString(),
          lastActiveAt: new Date(Date.now() - 3600_000 * 24 * 60).toISOString(),
          status: "INACTIVE",
        },
      ];
    }

    if (!this.rules[tenantId]) {
      this.rules[tenantId] = [
        {
          id: "rule-1",
          name: "Finance Department Auto-Provisioning",
          targetType: "DEPARTMENT",
          targetValue: "Finance",
          entitlementCodes: ["core-erp", "advanced-analytics"],
          priority: 1,
          enabled: true,
        },
        {
          id: "rule-2",
          name: "Executive Leadership Bundle",
          targetType: "ROLE",
          targetValue: "C-Level",
          entitlementCodes: ["core-erp", "ai-copilot", "advanced-analytics"],
          priority: 2,
          enabled: true,
        },
      ];
    }
  }

  async getSummary(tenantId: string) {
    this.initTenant(tenantId);
    const items = this.entitlements[tenantId];
    const totalSeats = 150;
    const allocatedSeats = this.allocations[tenantId].filter((a) => a.status === "ACTIVE").length;

    return {
      planEdition: "Enterprise Plus",
      totalSeats,
      allocatedSeats,
      availableSeats: totalSeats - allocatedSeats,
      reclaimableSeats: this.allocations[tenantId].filter((a) => a.status === "INACTIVE").length,
      entitlements: items,
    };
  }

  async listAllocations(tenantId: string) {
    this.initTenant(tenantId);
    return this.allocations[tenantId];
  }

  async allocateLicense(
    tenantId: string,
    input: {
      userId: string;
      userName: string;
      userEmail: string;
      department: string;
      entitlements: string[];
    },
  ) {
    this.initTenant(tenantId);
    const existing = this.allocations[tenantId].find((a) => a.userId === input.userId);
    if (existing) {
      existing.assignedEntitlements = input.entitlements;
      existing.status = "ACTIVE";
      return existing;
    }

    const newAlloc: LicenseAllocation = {
      id: `alc-${Date.now()}`,
      userId: input.userId,
      userName: input.userName,
      userEmail: input.userEmail,
      department: input.department || "General",
      assignedEntitlements: input.entitlements,
      allocatedAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
      status: "ACTIVE",
    };
    this.allocations[tenantId].unshift(newAlloc);
    return newAlloc;
  }

  async reclaimLicense(tenantId: string, allocationId: string) {
    this.initTenant(tenantId);
    const alloc = this.allocations[tenantId].find((a) => a.id === allocationId);
    if (!alloc) throw new Error("Allocation not found");
    alloc.status = "INACTIVE";
    alloc.assignedEntitlements = [];
    return alloc;
  }

  async listAssignmentRules(tenantId: string) {
    this.initTenant(tenantId);
    return this.rules[tenantId];
  }

  async saveAssignmentRule(
    tenantId: string,
    input: {
      name: string;
      targetType: "DEPARTMENT" | "ROLE";
      targetValue: string;
      entitlementCodes: string[];
    },
  ) {
    this.initTenant(tenantId);
    const newRule: EntitlementAssignmentRule = {
      id: `rule-${Date.now()}`,
      name: input.name,
      targetType: input.targetType,
      targetValue: input.targetValue,
      entitlementCodes: input.entitlementCodes,
      priority: this.rules[tenantId].length + 1,
      enabled: true,
    };
    this.rules[tenantId].push(newRule);
    return newRule;
  }
}
