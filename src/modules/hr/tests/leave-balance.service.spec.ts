/**
 * E22 exit criterion: "...leave..." — a leave request must be checked
 * against the employee's real remaining balance (in DAYS, not request
 * rows) before it can be approved.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

let leaveRequests: any[];
let leavePolicies: any[];
let employees: any[];
let seq = 0;
const nextId = (p: string) => `${p}-${++seq}`;

vi.mock("@kannan19302/database", () => ({
  prisma: {
    employee: {
      findFirst: vi.fn(({ where }: any) => employees.find((e) => e.id === where.id || e.userId === where.userId) ?? null),
      findMany: vi.fn(() => employees),
    },
    leavePolicy: {
      findMany: vi.fn(({ where }: any) => leavePolicies.filter((p) => p.tenantId === where.tenantId)),
      findFirst: vi.fn(({ where }: any) => leavePolicies.find((p) => p.id === where.id) ?? null),
    },
    leaveRequest: {
      findMany: vi.fn(({ where }: any) =>
        leaveRequests.filter(
          (r) =>
            r.tenantId === where.tenantId &&
            (!where.employeeId || r.employeeId === where.employeeId) &&
            (!where.policyId || r.policyId === where.policyId) &&
            (!where.status || r.status === where.status),
        ),
      ),
      count: vi.fn(({ where }: any) =>
        leaveRequests.filter((r) => r.tenantId === where.tenantId && r.employeeId === where.employeeId && r.policyId === where.policyId && r.status === where.status).length,
      ),
      findFirst: vi.fn(({ where }: any) => leaveRequests.find((r) => r.id === where.id && r.tenantId === where.tenantId) ?? null),
      create: vi.fn(({ data }: any) => {
        const row = { id: nextId("leave"), status: "PENDING", ...data };
        leaveRequests.push(row);
        return row;
      }),
      update: vi.fn(({ where, data }: any) => {
        const row = leaveRequests.find((r) => r.id === where.id);
        Object.assign(row, data);
        return row;
      }),
    },
    organization: { findFirst: vi.fn(() => ({ id: "org1" })) },
  },
}));

import { HrService } from "../hr.service";

const DAY = 24 * 60 * 60 * 1000;

describe("E22 · leave balance is computed in real days and enforced before approval", () => {
  let service: HrService;

  beforeEach(() => {
    vi.clearAllMocks();
    seq = 0;
    employees = [{ id: "emp-1", tenantId: "t1", userId: "u1" }];
    leavePolicies = [{ id: "policy-1", tenantId: "t1", name: "Annual Leave", annualAllocation: 10 }];
    leaveRequests = [];
    service = new HrService();
  });

  it("getLeaveBalances counts USED DAYS, not the number of approved request rows — a 10-day approved request must consume 10 days, not 1", async () => {
    leaveRequests.push({
      id: "lr-1",
      tenantId: "t1",
      employeeId: "emp-1",
      policyId: "policy-1",
      status: "APPROVED",
      startDate: new Date("2026-03-01"),
      endDate: new Date("2026-03-10"), // 10 inclusive days
    });

    const balances = await service.getLeaveBalances("t1", "emp-1");
    const annual = balances.find((b: any) => b.leaveTypeId === "policy-1");
    expect(annual.usedDays).toBe(10);
    expect(annual.remaining).toBe(0);
  });

  it("REFUSES to approve a leave request that would exceed the employee's remaining balance — the exit criterion's own 'leave' non-negotiable", async () => {
    // 8 days already approved, only 2 remain of a 10-day annual allocation.
    leaveRequests.push({
      id: "lr-1",
      tenantId: "t1",
      employeeId: "emp-1",
      policyId: "policy-1",
      status: "APPROVED",
      startDate: new Date("2026-01-01"),
      endDate: new Date("2026-01-08"), // 8 days
    });
    // A NEW pending request for 5 more days — would blow past the 2 remaining.
    leaveRequests.push({
      id: "lr-2",
      tenantId: "t1",
      employeeId: "emp-1",
      policyId: "policy-1",
      status: "PENDING",
      startDate: new Date("2026-02-01"),
      endDate: new Date("2026-02-05"), // 5 days
    });

    await expect(service.approveLeaveRequest("t1", "lr-2", "manager-1")).rejects.toThrow(/remain/i);
    expect(leaveRequests.find((r) => r.id === "lr-2").status).toBe("PENDING"); // unchanged
  });

  it("ALLOWS approving a leave request that fits within the remaining balance", async () => {
    leaveRequests.push({
      id: "lr-1",
      tenantId: "t1",
      employeeId: "emp-1",
      policyId: "policy-1",
      status: "PENDING",
      startDate: new Date("2026-01-01"),
      endDate: new Date("2026-01-03"), // 3 days, well within 10
    });

    const result = await service.approveLeaveRequest("t1", "lr-1", "manager-1");
    expect(result.status).toBe("APPROVED");
  });
});
