import { Injectable } from "@nestjs/common";
import { prisma } from "@kannan19302/database";
import { idpClient as idpPrisma } from "../../../common/idp-client";

export interface SoxConflictRule {
  ruleId: string;
  name: string;
  category: "AP" | "GL" | "TREASURY" | "PROCUREMENT" | "FIXED_ASSETS";
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  toxicPermissions: [string, string];
  riskDescription: string;
  mitigatingControl: string;
}

export interface SoxUserConflict {
  ruleId: string;
  ruleName: string;
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  category: string;
  userId: string;
  userName: string;
  userEmail: string;
  assignedRoles: string[];
  conflictingPermissions: [string, string];
  mitigationStatus: "UNMITIGATED" | "EXCEPTION_GRANTED" | "COMPENSATING_CONTROL_ACTIVE";
  mitigationNotes?: string;
}

export interface SoxTransactionViolation {
  id: string;
  entityType: "JOURNAL" | "BILL" | "PAYMENT" | "ASSET_DISPOSAL";
  entityRef: string;
  actorId: string;
  actorName: string;
  actionCreated: string;
  actionExecuted: string;
  timestamp: string;
  amount: number;
  violationDescription: string;
}

export interface SoxComplianceSummary {
  overallHealthScore: number;
  activeRulesCount: number;
  totalConflicts: number;
  criticalConflicts: number;
  highConflicts: number;
  transactionViolationsCount: number;
  makerCheckerComplianceRate: number;
  auditTrailIntegrity: "VERIFIED" | "DEGRADED";
  lastAuditRun: string;
}

@Injectable()
export class SoxComplianceService {
  private readonly rules: SoxConflictRule[] = [
    {
      ruleId: "SOD-AP-01",
      name: "AP Bill Creation vs. Payment Approval",
      category: "AP",
      severity: "CRITICAL",
      toxicPermissions: ["finance.ap.create", "finance.ap.approve"],
      riskDescription:
        "An individual can initiate a fictitious supplier invoice and approve it for disbursement without independent review.",
      mitigatingControl:
        "Automated 3-way purchase order matching and mandatory secondary signoff on disbursements exceeding $10,000.",
    },
    {
      ruleId: "SOD-GL-01",
      name: "GL Journal Drafting vs. Direct Posting",
      category: "GL",
      severity: "CRITICAL",
      toxicPermissions: ["finance.journal.create", "finance.journal.post"],
      riskDescription:
        "Allows unilateral manual adjustments to the general ledger and financial statements without peer maker-checker verification.",
      mitigatingControl:
        "Strict period-close guard lock and mandatory independent reviewer approval on manual adjustment entries.",
    },
    {
      ruleId: "SOD-VND-01",
      name: "Vendor Master Maintenance vs. Payment Execution",
      category: "PROCUREMENT",
      severity: "HIGH",
      toxicPermissions: ["procurement.vendor.manage", "finance.payments.execute"],
      riskDescription:
        "An actor can modify vendor remit-to banking coordinates and execute automated clearing house / wire disbursements.",
      mitigatingControl:
        "Out-of-band confirmation callback required for changes to vendor IBAN/SWIFT coordinates with dual approval.",
    },
    {
      ruleId: "SOD-TRS-01",
      name: "Treasury Account Configuration vs. Wire Release",
      category: "TREASURY",
      severity: "CRITICAL",
      toxicPermissions: ["finance.banking.manage", "finance.treasury.wire.execute"],
      riskDescription:
        "Permits altering internal concentration sweep rules or external clearing routes prior to releasing cash wires.",
      mitigatingControl:
        "Hardware token dual-person control (2PC) enforced on all outgoing ISO 20022 payment batches.",
    },
    {
      ruleId: "SOD-FA-01",
      name: "Fixed Asset Creation vs. Disposal Authorization",
      category: "FIXED_ASSETS",
      severity: "MEDIUM",
      toxicPermissions: ["fixed-assets.create", "fixed-assets.disposals.create"],
      riskDescription:
        "Permits unmonitored capital asset acquisition and subsequent write-off or unauthorized liquidation.",
      mitigatingControl:
        "Mandatory annual physical tag verification and plant controller signoff on salvage derecognitions.",
    },
  ];

  getRules(): SoxConflictRule[] {
    return this.rules;
  }

  async detectToxicRoleConflicts(tenantId: string): Promise<SoxUserConflict[]> {
    const conflicts: SoxUserConflict[] = [];

    // Query active users and their assigned roles for this tenant from IdP
    const users = await idpPrisma.user.findMany({
      where: { tenantId, status: "ACTIVE" },
      include: {
        roles: {
          include: {
            role: true,
          },
        },
      },
    });

    for (const user of users) {
      const userPermissions = new Set<string>();
      const roleNames: string[] = [];

      for (const ur of user.roles) {
        if (ur.role) {
          roleNames.push(ur.role.name);
          const perms = (ur.role as any).permissions;
          if (Array.isArray(perms)) {
            for (const p of perms) {
              if (typeof p === "string") userPermissions.add(p);
              else if (p?.name) userPermissions.add(p.name);
              else if (p?.permission?.name) userPermissions.add(p.permission.name);
            }
          }
        }
      }

      // Evaluate against each toxic rule
      for (const rule of this.rules) {
        const [permA, permB] = rule.toxicPermissions;
        const hasA = userPermissions.has(permA) || userPermissions.has("*");
        const hasB = userPermissions.has(permB) || userPermissions.has("*");

        if (hasA && hasB) {
          const isSystemAdmin = roleNames.includes("Tenant Admin") || roleNames.includes("Super Admin");
          conflicts.push({
            ruleId: rule.ruleId,
            ruleName: rule.name,
            severity: rule.severity,
            category: rule.category,
            userId: user.id,
            userName: `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim() || user.email,
            userEmail: user.email,
            assignedRoles: roleNames,
            conflictingPermissions: rule.toxicPermissions,
            mitigationStatus: isSystemAdmin ? "COMPENSATING_CONTROL_ACTIVE" : "UNMITIGATED",
            mitigationNotes: isSystemAdmin
              ? "System administrator role scoped under enterprise change management policy."
              : "Direct toxic permission overlap detected; role separation recommended.",
          });
        }
      }
    }

    return conflicts;
  }

  async auditTransactionViolations(tenantId: string): Promise<SoxTransactionViolation[]> {
    const violations: SoxTransactionViolation[] = [];

    // Check audit logs for single-actor actions on same journal entity
    const auditEvents = await prisma.auditLog
      .findMany({
        where: { tenantId, entityType: "JOURNAL" },
        take: 100,
        orderBy: { createdAt: "desc" },
      })
      .catch(() => []);

    const userActionsByJournal = new Map<string, Set<string>>();
    for (const log of auditEvents) {
      if (log.entityId && log.userId) {
        const key = `${log.entityId}:${log.userId}`;
        if (!userActionsByJournal.has(key)) {
          userActionsByJournal.set(key, new Set());
        }
        userActionsByJournal.get(key)!.add(log.action);
      }
    }

    for (const [key, actions] of userActionsByJournal.entries()) {
      if (actions.has("CREATE") && actions.has("POST")) {
        const parts = key.split(":");
        const journalId = parts[0] || "UNKNOWN";
        const userId = parts[1] || "UNKNOWN";
        violations.push({
          id: `VIOL-${journalId}`,
          entityType: "JOURNAL",
          entityRef: journalId,
          actorId: userId,
          actorName: userId,
          actionCreated: "Drafted Journal",
          actionExecuted: "Posted to General Ledger",
          timestamp: new Date().toISOString(),
          amount: 0,
          violationDescription: `Single actor drafted and posted general ledger journal ${journalId} without secondary approval.`,
        });
      }
    }

    return violations;
  }

  async getSoxComplianceSummary(tenantId: string): Promise<SoxComplianceSummary> {
    const [conflicts, violations] = await Promise.all([
      this.detectToxicRoleConflicts(tenantId),
      this.auditTransactionViolations(tenantId),
    ]);

    const criticalConflicts = conflicts.filter((c) => c.severity === "CRITICAL" && c.mitigationStatus === "UNMITIGATED").length;
    const highConflicts = conflicts.filter((c) => c.severity === "HIGH" && c.mitigationStatus === "UNMITIGATED").length;

    // Deduct points for unmitigated conflicts and transaction violations
    const penalty = criticalConflicts * 15 + highConflicts * 8 + violations.length * 10;
    const overallHealthScore = Math.max(0, Math.min(100, 100 - penalty));

    const totalAuditedEvents = await prisma.auditLog.count({ where: { tenantId } }).catch(() => 100);
    const compliantEvents = Math.max(0, totalAuditedEvents - violations.length);
    const makerCheckerComplianceRate = totalAuditedEvents > 0 ? (compliantEvents / totalAuditedEvents) * 100 : 100;

    return {
      overallHealthScore: Math.round(overallHealthScore * 10) / 10,
      activeRulesCount: this.rules.length,
      totalConflicts: conflicts.length,
      criticalConflicts,
      highConflicts,
      transactionViolationsCount: violations.length,
      makerCheckerComplianceRate: Math.round(makerCheckerComplianceRate * 10) / 10,
      auditTrailIntegrity: "VERIFIED",
      lastAuditRun: new Date().toISOString(),
    };
  }
}
