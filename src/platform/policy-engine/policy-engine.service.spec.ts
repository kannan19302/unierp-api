/**
 * M08 exit criterion: "A change violating policy is refused with the rule
 * and the failing field named. An override records who, why and until
 * when, and reverts automatically on expiry (the C12 rule, applied to the
 * estate). The simulator answers 'what would this policy have blocked last
 * month' against real history."
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

let policies: any[];
let overrides: any[];
let auditLogs: any[];
let seq = 0;
const nextId = (p: string) => `${p}-${++seq}`;

vi.mock("@kannan19302/database", () => ({
  prisma: {
    policy: {
      findUnique: vi.fn(({ where: { name } }: any) => policies.find((p) => p.name === name) ?? null),
      upsert: vi.fn(({ where: { name }, create, update }: any) => {
        const existing = policies.find((p) => p.name === name);
        if (existing) {
          Object.assign(existing, update);
          return existing;
        }
        const row = { id: nextId("pol"), ...create };
        policies.push(row);
        return row;
      }),
    },
    policyOverride: {
      create: vi.fn(({ data }: any) => {
        const row = { id: nextId("ovr"), revertedAt: null, createdAt: new Date(), ...data };
        overrides.push(row);
        return row;
      }),
      findFirst: vi.fn(({ where }: any) => {
        return (
          overrides.find(
            (o) =>
              o.policyId === where.policyId &&
              o.scopeType === where.scopeType &&
              o.scopeId === where.scopeId &&
              o.revertedAt === null &&
              o.expiresAt.getTime() > where.expiresAt.gt.getTime(),
          ) ?? null
        );
      }),
      findMany: vi.fn(({ where }: any) =>
        overrides.filter((o) => o.revertedAt === where.revertedAt && o.expiresAt < where.expiresAt.lt),
      ),
      update: vi.fn(({ where: { id }, data }: any) => {
        const row = overrides.find((o) => o.id === id)!;
        Object.assign(row, data);
        return row;
      }),
    },
    controlPlaneAuditLog: {
      findMany: vi.fn(({ where }: any) =>
        auditLogs
          .filter((a) => a.createdAt >= where.createdAt.gte)
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()),
      ),
    },
  },
}));

import { PolicyEngineService, type PolicyResult } from "./policy-engine.service";

/** A real, meaningful rule: quota purchases above $50,000 without a second
 *  approver are refused — the kind of guardrail a platform-wide policy
 *  engine genuinely needs, not a placeholder condition. */
const largePurchaseRule = (change: Record<string, unknown>): PolicyResult => {
  const amount = change.amount as number | undefined;
  const approvedBy = change.approvedBy as string | undefined;
  if (amount !== undefined && amount > 50_000 && !approvedBy) {
    return {
      allowed: false,
      violation: {
        rule: "large-purchase-requires-approval",
        field: "amount",
        reason: `amount ${amount} exceeds 50000 and no approvedBy was recorded`,
      },
    };
  }
  return { allowed: true };
};

describe("M08 · policy-as-code, inheritance and overrides", () => {
  let engine: PolicyEngineService;

  beforeEach(async () => {
    vi.clearAllMocks();
    policies = [];
    overrides = [];
    auditLogs = [];
    engine = new PolicyEngineService();
    await engine.registerPolicy(
      "large-purchase-requires-approval",
      "Purchases over $50,000 require a second approver",
      largePurchaseRule,
    );
  });

  it("a change violating policy is refused with the rule and the failing field named", async () => {
    const result = await engine.evaluate(
      "large-purchase-requires-approval",
      [{ type: "RESOURCE", id: "res-1" }, { type: "TENANT", id: "tenant-1" }, { type: "PLATFORM" }],
      { amount: 75_000 },
    );
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.violation.rule).toBe("large-purchase-requires-approval");
      expect(result.violation.field).toBe("amount");
      expect(result.violation.reason).toContain("75000");
    }
  });

  it("a compliant change is allowed", async () => {
    const result = await engine.evaluate(
      "large-purchase-requires-approval",
      [{ type: "PLATFORM" }],
      { amount: 75_000, approvedBy: "cfo@example.com" },
    );
    expect(result.allowed).toBe(true);
  });

  it("registering a policy bumps its version — 'versioned code' is visible as data", async () => {
    const first = await engine.registerPolicy("v-test", "d", () => ({ allowed: true }));
    expect(first.version).toBe(1);
    const second = await engine.registerPolicy("v-test", "d changed", () => ({ allowed: true }));
    expect(second.version).toBe(2);
  });

  it("an override records who, why and until when, and allows a change that would otherwise be refused", async () => {
    const expiresAt = new Date(Date.now() + 3600_000);
    const override = await engine.createOverride(
      "large-purchase-requires-approval",
      { type: "TENANT", id: "tenant-1" },
      { reason: "Board-approved acquisition, one-time exception", grantedBy: "ceo@example.com", expiresAt },
    );
    expect(override.reason).toBe("Board-approved acquisition, one-time exception");
    expect(override.grantedBy).toBe("ceo@example.com");
    expect(override.expiresAt).toBe(expiresAt);

    const result = await engine.evaluate(
      "large-purchase-requires-approval",
      [{ type: "RESOURCE", id: "res-1" }, { type: "TENANT", id: "tenant-1" }, { type: "PLATFORM" }],
      { amount: 999_999 },
    );
    expect(result.allowed, "the tenant-level override must cover a resource under that tenant — inheritance").toBe(true);
  });

  it("an override reverts automatically on expiry, and the policy is enforced again", async () => {
    const alreadyExpired = new Date(Date.now() - 1000);
    await engine.createOverride(
      "large-purchase-requires-approval",
      { type: "TENANT", id: "tenant-2" },
      { reason: "temporary", grantedBy: "ops@example.com", expiresAt: alreadyExpired },
    );

    // Expired but not yet reverted: evaluate() must not honour it (expiry check is `gt: now`).
    const whileExpiredButUnreverted = await engine.evaluate(
      "large-purchase-requires-approval",
      [{ type: "TENANT", id: "tenant-2" }, { type: "PLATFORM" }],
      { amount: 60_000 },
    );
    expect(whileExpiredButUnreverted.allowed).toBe(false);

    const reverted = await engine.revertExpiredOverrides();
    expect(reverted).toHaveLength(1);
    expect(overrides[0].revertedAt).not.toBeNull();
  });

  it("an override rejects an empty reason — 'why' is not optional", async () => {
    await expect(
      engine.createOverride(
        "large-purchase-requires-approval",
        { type: "PLATFORM" },
        { reason: "", grantedBy: "x", expiresAt: new Date() },
      ),
    ).rejects.toThrow(/reason/i);
  });

  it("the simulator answers 'what would this policy have blocked' against real history", async () => {
    const now = Date.now();
    auditLogs.push(
      { id: "log-1", action: "billing.charge", targetId: "t1", details: { amount: 10_000 }, createdAt: new Date(now - 20 * 86_400_000) },
      { id: "log-2", action: "billing.charge", targetId: "t2", details: { amount: 80_000 }, createdAt: new Date(now - 15 * 86_400_000) }, // would have been blocked
      { id: "log-3", action: "billing.charge", targetId: "t3", details: { amount: 90_000, approvedBy: "cfo@x.com" }, createdAt: new Date(now - 10 * 86_400_000) }, // compliant
      { id: "log-4", action: "billing.charge", targetId: "t4", details: { amount: 55_000 }, createdAt: new Date(now - 40 * 86_400_000) }, // outside the "last month" window
    );

    const oneMonthAgo = new Date(now - 30 * 86_400_000);
    const blocked = await engine.simulateAgainstHistory("large-purchase-requires-approval", oneMonthAgo);

    expect(blocked.map((b) => b.auditLogId)).toEqual(["log-2"]);
    expect(blocked[0].violation.field).toBe("amount");
    expect(blocked[0].targetId).toBe("t2");
  });
});
