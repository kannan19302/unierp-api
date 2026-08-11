/**
 * D04 exit criterion: "An approval routes correctly through a
 * three-level hierarchy with a vacant position handled by escalation,
 * not by silence."
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

let positions: any[];
let routings: any[];
let seq = 0;
const nextId = (p: string) => `${p}-${++seq}`;

vi.mock("@kannan19302/database", () => ({
  prisma: {
    orgPosition: {
      findUnique: vi.fn(({ where: { id } }: any) => positions.find((p) => p.id === id) ?? null),
    },
    approvalRouting: {
      create: vi.fn(({ data }: any) => { const row = { id: nextId("routing"), routedAt: new Date(), ...data }; routings.push(row); return row; }),
    },
  },
}));

import { ApprovalRoutingService } from "../approval-routing.service";

describe("D04 · approval routing over a three-level org hierarchy, vacancy handled by escalation", () => {
  let routing: ApprovalRoutingService;

  beforeEach(() => {
    vi.clearAllMocks();
    positions = [];
    routings = [];
    routing = new ApprovalRoutingService();
  });

  function addPosition(id: string, occupantUserId: string | null, managerPositionId: string | null, tenantId = "t1") {
    positions.push({ id, tenantId, occupantUserId, managerPositionId, title: id });
  }

  it("ROUTES to the direct manager when occupied — no escalation needed", async () => {
    addPosition("mgr", "user-mgr", null);
    addPosition("staff", null, "mgr"); // requester's own position, not itself an approver level

    const result = await routing.routeApproval("t1", "req-1", "mgr");
    expect(result.finalApproverUserId).toBe("user-mgr");
    expect((result.approverChain as any[])).toEqual([{ positionId: "mgr", level: 1, userId: "user-mgr", escalated: false }]);
  });

  it("ESCALATES past a VACANT level-1 position to a filled level-2 — not silence", async () => {
    addPosition("director", "user-director", null);
    addPosition("mgr-vacant", null, "director");

    const result = await routing.routeApproval("t1", "req-2", "mgr-vacant");

    expect(result.finalApproverUserId).toBe("user-director");
    expect((result.approverChain as any[])).toEqual([
      { positionId: "mgr-vacant", level: 1, userId: null, escalated: true },
      { positionId: "director", level: 2, userId: "user-director", escalated: true },
    ]);
  });

  it("ROUTES CORRECTLY through a full THREE-level hierarchy: levels 1 and 2 vacant, level 3 resolves", async () => {
    addPosition("vp", "user-vp", null);
    addPosition("director-vacant", null, "vp");
    addPosition("mgr-vacant", null, "director-vacant");

    const result = await routing.routeApproval("t1", "req-3", "mgr-vacant", 3);

    expect(result.finalApproverUserId).toBe("user-vp");
    expect((result.approverChain as any[]).map((e) => e.level)).toEqual([1, 2, 3]);
    expect((result.approverChain as any[])[2]).toEqual({ positionId: "vp", level: 3, userId: "user-vp", escalated: true });
  });

  it("REFUSES loudly when every position within the level ceiling is vacant — never routes to nobody", async () => {
    addPosition("top-vacant", null, null);
    addPosition("mid-vacant", null, "top-vacant");
    addPosition("bottom-vacant", null, "mid-vacant");

    await expect(routing.routeApproval("t1", "req-4", "bottom-vacant", 3)).rejects.toThrow(/No occupied position found/);
    expect(routings).toHaveLength(0);
  });

  it("refuses a position belonging to a DIFFERENT tenant — cross-tenant routing is never silently allowed", async () => {
    addPosition("other-tenant-mgr", "user-x", null, "t2");
    await expect(routing.routeApproval("t1", "req-5", "other-tenant-mgr")).rejects.toThrow(/not found in tenant/);
  });
});
