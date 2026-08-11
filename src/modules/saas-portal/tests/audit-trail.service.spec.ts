/**
 * D05 exit criterion: "A tenant admin answers 'who changed this and
 * when' for any record without contacting support, and exports evidence
 * for an auditor (G-9)."
 *
 * SaasPortalAuditTrailDeepService.getAuditLogs() previously returned one
 * HARDCODED fake row regardless of tenant or filters — a tenant admin
 * could never actually answer "who changed record X and when" from it,
 * since it never queried the real ChangeHistory table at all. This spec
 * proves the gap, then proves the fix: real search/filter against
 * ChangeHistory, and a real export.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

let changeHistory: any[];

vi.mock("@kannan19302/database", () => ({
  prisma: {
    changeHistory: {
      findMany: vi.fn(({ where, orderBy, take, skip }: any) => {
        let rows = changeHistory.filter((c) => c.tenantId === where.tenantId);
        if (where.entityType) rows = rows.filter((c) => c.entityType === where.entityType);
        if (where.entityId) rows = rows.filter((c) => c.entityId === where.entityId);
        if (where.userId) rows = rows.filter((c) => c.userId === where.userId);
        if (where.action) rows = rows.filter((c) => c.action === where.action);
        if (where.createdAt?.gte) rows = rows.filter((c) => c.createdAt >= where.createdAt.gte);
        if (where.createdAt?.lte) rows = rows.filter((c) => c.createdAt <= where.createdAt.lte);
        if (orderBy?.createdAt === "desc") rows = [...rows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        if (skip) rows = rows.slice(skip);
        if (take) rows = rows.slice(0, take);
        return rows;
      }),
      count: vi.fn(({ where }: any) => changeHistory.filter((c) => c.tenantId === where.tenantId && (!where.entityId || c.entityId === where.entityId)).length),
    },
  },
}));

import { SaasPortalAuditTrailDeepService } from "../audit-trail.service";

describe("D05 · tenant audit trail — real search/filter/export against ChangeHistory", () => {
  let auditSvc: SaasPortalAuditTrailDeepService;

  beforeEach(() => {
    vi.clearAllMocks();
    changeHistory = [
      { id: "ch-1", tenantId: "t1", userId: "u1", userName: "Alice", entityType: "Invoice", entityId: "inv-1", action: "UPDATE", fieldChanges: [{ field: "status", from: "DRAFT", to: "SENT" }], createdAt: new Date("2026-08-01T10:00:00Z") },
      { id: "ch-2", tenantId: "t1", userId: "u2", userName: "Bob", entityType: "Invoice", entityId: "inv-1", action: "UPDATE", fieldChanges: [{ field: "amount", from: "100", to: "150" }], createdAt: new Date("2026-08-02T10:00:00Z") },
      { id: "ch-3", tenantId: "t1", userId: "u1", userName: "Alice", entityType: "Contact", entityId: "con-1", action: "CREATE", fieldChanges: [], createdAt: new Date("2026-08-03T10:00:00Z") },
      { id: "ch-4", tenantId: "t2", userId: "u3", userName: "Carol", entityType: "Invoice", entityId: "inv-1", action: "UPDATE", fieldChanges: [], createdAt: new Date("2026-08-01T10:00:00Z") },
    ];
    auditSvc = new SaasPortalAuditTrailDeepService();
  });

  it("ANSWERS 'who changed this and when' for a specific record — filtered to exactly its own entries, in order", async () => {
    const result = await auditSvc.getAuditLogs("t1", { entityType: "Invoice", entityId: "inv-1" });
    expect(result.entries.map((e: any) => e.userName)).toEqual(["Bob", "Alice"]); // most recent first
    expect(result.entries.every((e: any) => e.entityId === "inv-1")).toBe(true);
  });

  it("is strictly TENANT-SCOPED — tenant 1 never sees tenant 2's change on the same entityId", async () => {
    const result = await auditSvc.getAuditLogs("t1", { entityType: "Invoice", entityId: "inv-1" });
    expect(result.entries.every((e: any) => e.tenantId !== "t2")).toBe(true);
    expect(result.entries).toHaveLength(2);
  });

  it("FILTERS by action and by actor (userId)", async () => {
    const created = await auditSvc.getAuditLogs("t1", { action: "CREATE" });
    expect(created.entries).toHaveLength(1);
    expect(created.entries[0]!.entityType).toBe("Contact");

    const byAlice = await auditSvc.getAuditLogs("t1", { userId: "u1" });
    expect(byAlice.entries).toHaveLength(2);
  });

  it("EXPORTS evidence for an auditor: every real, matching record, as a flat structure — never the fake fixture", async () => {
    const exported = await auditSvc.exportAuditLogs("t1", { entityType: "Invoice", entityId: "inv-1" });
    expect(exported).toHaveLength(2);
    expect(exported[0]).toMatchObject({ entityType: "Invoice", entityId: "inv-1", tenantId: "t1" });
    expect(exported.some((r: any) => r.userName === "Bob")).toBe(true);
    expect(exported.some((r: any) => r.userName === "Carol")).toBe(false); // tenant 2's row never leaks into tenant 1's export
  });
});
