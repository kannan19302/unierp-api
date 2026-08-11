/**
 * M11 exit criterion: "A destructive plan cannot execute on one operator's
 * approval. A plan scheduled into a blackout window is refused at schedule
 * time, not at run time. A test proves this uses C04's mechanism — removing
 * C04's guard breaks this phase's test."
 *
 * Deliberately does NOT mock ControlPlaneApprovalsService (C04/M49's real
 * service). Only Prisma is mocked. This is what makes "removing C04's
 * guard breaks this phase's test" true: SchedulingService.decideApproval()
 * calls the real decide(), so a change to decide()'s own separation check
 * is exercised by this file too, not shielded by a stub standing in for it.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

let approvals: any[];
let blackouts: any[];
let scheduled: any[];
let auditLogs: any[];
let seq = 0;
const nextId = (p: string) => `${p}-${++seq}`;

vi.mock("@kannan19302/database", () => ({
  prisma: {
    controlPlaneApproval: {
      create: vi.fn(({ data }: any) => {
        const row = { id: nextId("appr"), status: "PENDING", approvedBy: null, ...data };
        approvals.push(row);
        return row;
      }),
      findUnique: vi.fn(({ where: { id } }: any) => approvals.find((a) => a.id === id) ?? null),
      update: vi.fn(({ where: { id }, data }: any) => {
        const row = approvals.find((a) => a.id === id)!;
        Object.assign(row, data);
        return row;
      }),
    },
    controlPlaneAuditLog: {
      findFirst: vi.fn(() => null),
      create: vi.fn(({ data }: any) => {
        const row = { id: nextId("audit"), ...data };
        auditLogs.push(row);
        return row;
      }),
    },
    blackoutPeriod: {
      create: vi.fn(({ data }: any) => {
        const row = { id: nextId("bo"), ...data };
        blackouts.push(row);
        return row;
      }),
      findMany: vi.fn(({ where }: any) =>
        blackouts.filter((b) => b.startTime <= where.startTime.lte && b.endTime >= where.endTime.gte),
      ),
    },
    scheduledOperation: {
      create: vi.fn(({ data }: any) => {
        const row = { id: nextId("sched"), status: "SCHEDULED", ...data };
        scheduled.push(row);
        return row;
      }),
    },
  },
}));

import { SchedulingService } from "./scheduling.service";
import { ControlPlaneApprovalsService } from "../v1/control-plane-approvals.service";
import { ControlPlaneAuditService } from "../v1/control-plane-audit.service";
import type { Plan } from "./planning.service";

function fakePlan(resourceId: string): Plan {
  return {
    id: `plan-${resourceId}`,
    resourceId,
    diff: [],
    affectedResourceIds: [resourceId],
    executionOrder: [resourceId],
    estimatedCostDelta: null,
    reversal: { resourceId, priorDesiredState: null },
    createdAt: new Date(),
  };
}

describe("M11 · approvals, two-person control and scheduling", () => {
  let scheduling: SchedulingService;

  beforeEach(() => {
    vi.clearAllMocks();
    approvals = [];
    blackouts = [];
    scheduled = [];
    auditLogs = [];
    const approvalsService = new ControlPlaneApprovalsService(new ControlPlaneAuditService());
    scheduling = new SchedulingService(approvalsService);
  });

  it("a destructive plan cannot execute on one operator's approval — the same operator cannot request and approve", async () => {
    const plan = fakePlan("res-1");
    const approval = await scheduling.requestApproval(plan, "operator-a");

    await expect(scheduling.decideApproval(approval.id, "operator-a", "APPROVED")).rejects.toThrow(
      /cannot also approve their own request/i,
    );
  });

  it("a destructive plan DOES execute-eligible once a genuinely different operator approves", async () => {
    const plan = fakePlan("res-2");
    const approval = await scheduling.requestApproval(plan, "operator-a");

    const decided = await scheduling.decideApproval(approval.id, "operator-b", "APPROVED");
    expect(decided.status).toBe("APPROVED");
    expect(decided.approvedBy).toBe("operator-b");
  });

  it("a plan scheduled into a blackout window is refused at schedule time, not at run time", async () => {
    const plan = fakePlan("res-3");
    const start = new Date("2026-12-24T00:00:00Z");
    const end = new Date("2026-12-26T23:59:59Z");
    await scheduling.createBlackoutPeriod("Holiday freeze", start, end);

    const insideBlackout = new Date("2026-12-25T12:00:00Z");
    await expect(scheduling.scheduleOperation(plan, insideBlackout)).rejects.toThrow(/blackout period/i);

    // Refused BEFORE any ScheduledOperation row exists — not created-then-
    // never-run, which would be a run-time failure disguised as schedule-time.
    expect(scheduled).toHaveLength(0);
  });

  it("a plan scheduled outside any blackout window succeeds", async () => {
    const plan = fakePlan("res-4");
    await scheduling.createBlackoutPeriod(
      "Holiday freeze",
      new Date("2026-12-24T00:00:00Z"),
      new Date("2026-12-26T23:59:59Z"),
    );

    const outsideBlackout = new Date("2026-12-27T09:00:00Z");
    const result = await scheduling.scheduleOperation(plan, outsideBlackout);
    expect(result.status).toBe("SCHEDULED");
    expect(scheduled).toHaveLength(1);
  });

  it("a blackout period with endTime before startTime is rejected", async () => {
    await expect(
      scheduling.createBlackoutPeriod("bad window", new Date("2026-01-02"), new Date("2026-01-01")),
    ).rejects.toThrow(/endTime.*after.*startTime/i);
  });
});
