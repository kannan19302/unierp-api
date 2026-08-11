import { BadRequestException, Injectable } from "@nestjs/common";
import { prisma } from "@kannan19302/database";

export type PolicyScopeType = "PLATFORM" | "REGION" | "TENANT" | "RESOURCE";

export interface PolicyScope {
  type: PolicyScopeType;
  id?: string;
}

export interface PolicyViolation {
  rule: string;
  field: string;
  reason: string;
}

export type PolicyResult =
  | { allowed: true }
  | { allowed: false; violation: PolicyViolation };

/** The RULE itself is code — registered in-memory, the same pattern M02's
 *  capabilities, M03's providers and M05's adapters already use. */
export type PolicyRule = (change: Record<string, unknown>) => PolicyResult;

@Injectable()
export class PolicyEngineService {
  private readonly rules = new Map<string, PolicyRule>();

  /** Registers (or replaces) a policy's CODE. Bumps the DB row's version so
   *  "versioned code" is visible as data, not only inferred from git log. */
  async registerPolicy(name: string, description: string, rule: PolicyRule) {
    this.rules.set(name, rule);
    const existing = await (prisma as any).policy.findUnique({ where: { name } });
    return (prisma as any).policy.upsert({
      where: { name },
      create: { name, description, version: 1 },
      update: { description, version: (existing?.version ?? 0) + 1 },
    });
  }

  /**
   * Evaluates `change` against `policyName`'s rule for the given scope
   * chain (the target's own scope plus every scope it inherits from, most
   * specific first). An active override at ANY level in that chain — not
   * only the target's own — allows the change through: an override granted
   * at the tenant level covers every resource under that tenant, which is
   * what "inheritance" means for an exemption, not only for the rule.
   */
  async evaluate(
    policyName: string,
    scopeChain: PolicyScope[],
    change: Record<string, unknown>,
  ): Promise<PolicyResult> {
    const rule = this.rules.get(policyName);
    if (!rule) {
      throw new BadRequestException(`No policy registered with name "${policyName}"`);
    }

    for (const scope of scopeChain) {
      if (await this.hasActiveOverride(policyName, scope)) {
        return { allowed: true };
      }
    }

    return rule(change);
  }

  private async hasActiveOverride(policyName: string, scope: PolicyScope): Promise<boolean> {
    const policy = await (prisma as any).policy.findUnique({ where: { name: policyName } });
    if (!policy) return false;
    const override = await (prisma as any).policyOverride.findFirst({
      where: {
        policyId: policy.id,
        scopeType: scope.type,
        scopeId: scope.id ?? null,
        revertedAt: null,
        expiresAt: { gt: new Date() },
      },
    });
    return !!override;
  }

  /** Records who, why and until when — the C12 rule ("every override records
   *  who, why and until when"), applied here to the estate. */
  async createOverride(
    policyName: string,
    scope: PolicyScope,
    input: { reason: string; grantedBy: string; expiresAt: Date },
  ) {
    const policy = await (prisma as any).policy.findUnique({ where: { name: policyName } });
    if (!policy) {
      throw new BadRequestException(`No policy registered with name "${policyName}"`);
    }
    if (!input.reason) {
      throw new BadRequestException("An override must record a reason");
    }
    return (prisma as any).policyOverride.create({
      data: {
        policyId: policy.id,
        scopeType: scope.type,
        scopeId: scope.id ?? null,
        reason: input.reason,
        grantedBy: input.grantedBy,
        expiresAt: input.expiresAt,
      },
    });
  }

  /**
   * The C12 rule's other half: an expired override reverts automatically.
   * "Reverts" means marked reverted, not deleted — the exemption's own
   * history (who granted it, why, for how long) survives its expiry the
   * same way DriftRecord (M07) survives resolution.
   */
  async revertExpiredOverrides(): Promise<string[]> {
    const expired = await (prisma as any).policyOverride.findMany({
      where: { revertedAt: null, expiresAt: { lt: new Date() } },
    });
    const ids = expired.map((o: any) => o.id);
    for (const id of ids) {
      await (prisma as any).policyOverride.update({
        where: { id },
        data: { revertedAt: new Date() },
      });
    }
    return ids;
  }

  /**
   * "What would this policy have blocked last month" — run against REAL
   * history, not a synthetic fixture: the control-plane audit log (C03/M48),
   * which already records actor/action/target/details for every plane-1
   * mutation. This does not re-derive the scope chain an override would
   * have applied at the time (that would need reconstructing point-in-time
   * override state, out of scope here); it answers the rule-only question
   * the exit criterion actually asks — which past changes fail the rule as
   * it exists today.
   */
  async simulateAgainstHistory(
    policyName: string,
    since: Date,
  ): Promise<Array<{ auditLogId: string; action: string; targetId: string | null; violation: PolicyViolation }>> {
    const rule = this.rules.get(policyName);
    if (!rule) {
      throw new BadRequestException(`No policy registered with name "${policyName}"`);
    }
    const records = await (prisma as any).controlPlaneAuditLog.findMany({
      where: { createdAt: { gte: since } },
      orderBy: { createdAt: "asc" },
    });

    const blocked: Array<{ auditLogId: string; action: string; targetId: string | null; violation: PolicyViolation }> = [];
    for (const record of records) {
      const result = rule((record.details as Record<string, unknown>) ?? {});
      if (!result.allowed) {
        blocked.push({
          auditLogId: record.id,
          action: record.action,
          targetId: record.targetId,
          violation: result.violation,
        });
      }
    }
    return blocked;
  }
}
