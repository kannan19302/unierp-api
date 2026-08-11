/**
 * E05 exit criterion: "Any entity gains approvals by declaration. A vacant
 * approver escalates rather than stalling. Verified against a three-level
 * hierarchy with a vacancy."
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

let positions: any[];
let processes: any[];
let requests: any[];
let actions: any[];
let seq = 0;
const nextId = (p: string) => `${p}-${++seq}`;

vi.mock("@kannan19302/database", () => ({
  prisma: {
    orgPosition: {
      findUnique: vi.fn(({ where: { id } }: any) => positions.find((p) => p.id === id) ?? null),
    },
    approvalRouting: {
      create: vi.fn(({ data }: any) => ({ id: nextId("routing"), routedAt: new Date(), ...data })),
    },
    approvalProcess: {
      create: vi.fn(({ data }: any) => { const row = { id: nextId("process"), createdAt: new Date(), ...data }; processes.push(row); return row; }),
      findFirst: vi.fn(({ where }: any) =>
        processes.find((p) => p.id === where.id || (where.entity && p.entity === where.entity && p.tenantId === where.tenantId)) ?? null,
      ),
    },
    approvalRequest: {
      create: vi.fn(({ data }: any) => { const row = { id: nextId("request"), submittedAt: new Date(), ...data }; requests.push(row); return row; }),
      findFirst: vi.fn(({ where }: any) => requests.find((r) => r.id === where.id && r.tenantId === where.tenantId) ?? null),
      update: vi.fn(({ where, data }: any) => {
        const row = requests.find((r) => r.id === where.id);
        Object.assign(row, data);
        return row;
      }),
    },
    approvalAction: {
      create: vi.fn(({ data }: any) => { const row = { id: nextId("action"), actedAt: new Date(), ...data }; actions.push(row); return row; }),
      findMany: vi.fn(({ where }: any) => actions.filter((a) => a.requestId === where.requestId && a.step === where.step)),
    },
  },
}));

import { ApprovalChainEngineService } from "../approval-chain-engine.service";
import { ApprovalRoutingService } from "../approval-routing.service";

describe("E05 · approval-chain engine — any entity, by declaration, escalation-safe", () => {
  let engine: ApprovalChainEngineService;

  beforeEach(() => {
    vi.clearAllMocks();
    positions = [];
    processes = [];
    requests = [];
    actions = [];
    engine = new ApprovalChainEngineService(new ApprovalRoutingService());
  });

  function addPosition(id: string, occupantUserId: string | null, managerPositionId: string | null, tenantId = "t1") {
    positions.push({ id, tenantId, occupantUserId, managerPositionId, title: id });
  }

  it("declares an approval process for ANY entity type with zero entity-specific code", async () => {
    const process = await engine.declareApproval("t1", "org1", "Expense sign-off", "expense-report", [
      { level: 1, startPositionId: "mgr", mode: "ANY" },
    ], "creator-1");
    expect(process.entity).toBe("expense-report");
    expect((process.steps as any[])[0].startPositionId).toBe("mgr");
  });

  it("ESCALATES past two vacant levels to the first occupied position — verified on a real 3-level hierarchy with a vacancy", async () => {
    addPosition("director", "user-director", null);
    addPosition("mgr-vacant", null, "director");
    addPosition("lead-vacant", null, "mgr-vacant");

    const process = await engine.declareApproval("t1", "org1", "PO sign-off", "purchase-order", [
      { level: 1, startPositionId: "lead-vacant", mode: "ANY" },
    ], "creator-1");

    const request = await engine.submitForApproval("t1", "submitter-1", "purchase-order", "po-42", process.id);

    // The engine must have resolved the CURRENT step's real approver by
    // climbing the hierarchy past both vacancies, not left it null/pending
    // on a position no one occupies.
    expect((request.metadata as any).currentApprovers).toEqual(["user-director"]);

    // The vacant, escalated-past positions are unauthorized to approve.
    await expect(engine.approveStep("t1", request.id, "someone-else")).rejects.toThrow();

    // Only the resolved, real approver (found via escalation) may approve.
    const approved = await engine.approveStep("t1", request.id, "user-director", "looks good");
    expect(approved.status).toBe("APPROVED");
  });

  it("REFUSES to stall when every level in the hierarchy is vacant — a loud refusal, not a silent pending-forever request", async () => {
    addPosition("lead-vacant", null, null);

    const process = await engine.declareApproval("t1", "org1", "All vacant", "widget", [
      { level: 1, startPositionId: "lead-vacant", mode: "ANY" },
    ], "creator-1");

    await expect(engine.submitForApproval("t1", "submitter-1", "widget", "w-1", process.id)).rejects.toThrow();
  });

  it("a step declared with mode ALL requires every resolved approver before advancing (parallel step)", async () => {
    const process = await engine.declareApproval("t1", "org1", "Dual sign-off", "contract", [
      { level: 1, approverUserIds: ["user-a", "user-b"], mode: "ALL" },
    ], "creator-1");
    const request = await engine.submitForApproval("t1", "submitter-1", "contract", "c-1", process.id);

    const afterFirst = await engine.approveStep("t1", request.id, "user-a");
    expect(afterFirst.status).toBe("PENDING"); // one of two — not advanced yet

    const afterSecond = await engine.approveStep("t1", request.id, "user-b");
    expect(afterSecond.status).toBe("APPROVED");
  });

  it("REJECTS an approval attempt from a user not among the step's resolved approvers — the pre-existing gap this phase fixes", async () => {
    const process = await engine.declareApproval("t1", "org1", "Single approver", "invoice", [
      { level: 1, approverUserIds: ["authorized-user"], mode: "ANY" },
    ], "creator-1");
    const request = await engine.submitForApproval("t1", "submitter-1", "invoice", "inv-1", process.id);

    await expect(engine.approveStep("t1", request.id, "random-unauthorized-user")).rejects.toThrow(
      /not an authorized approver/i,
    );
  });
});
