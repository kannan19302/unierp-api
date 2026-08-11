/**
 * C04 exit criterion, re-verified during the Track M foundation sweep: "A
 * single operator cannot delete a tenant or read another tenant's records.
 * Break-glass use raises an alert and creates a review task."
 *
 * FINDING (D049): the schema's `ControlPlaneApproval.approvedBy` field —
 * designed for exactly this — was never checked, and nothing in the codebase
 * ever created an approval row at all. `grep -rn "controlPlaneApproval\.create"
 * src` returns zero hits outside this fix. So the "approval token" branch of
 * `TwoPersonControlGuard` could never be satisfied by anyone, ever, and the
 * ONLY functioning path through any `@TwoPersonControl()`-guarded endpoint
 * was break-glass: a single operator, alone, with a written reason of at
 * least 10 characters. "Two-person control" enforced single-person control,
 * unconditionally, because its only alternative path was unreachable.
 *
 * Separately: `ControlPlaneReviewTask`, created on every break-glass use, had
 * no reader anywhere in the codebase — no list endpoint, no console surface,
 * nothing that ever queried `status: "OPEN"`. A row nobody can see is not a
 * review; "raises an alert" had no notification transport behind it at all.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Reflector } from "@nestjs/core";
import { ForbiddenException } from "@nestjs/common";

const approvals: Record<string, any> = {};
const reviewTasks: any[] = [];

vi.mock("@kannan19302/database", () => ({
  prisma: {
    controlPlaneApproval: {
      findUnique: vi.fn(({ where: { id } }: any) => approvals[id] ?? null),
      update: vi.fn(({ where: { id }, data }: any) =>
        Object.assign(approvals[id], data),
      ),
    },
    controlPlaneReviewTask: {
      create: vi.fn(({ data }: any) => {
        const row = { id: `task-${reviewTasks.length + 1}`, status: "OPEN", ...data };
        reviewTasks.push(row);
        return row;
      }),
      findMany: vi.fn(() => reviewTasks),
    },
    controlPlaneAuditLog: {
      findFirst: vi.fn(() => null),
      create: vi.fn(({ data }: any) => ({ id: "audit-1", ...data })),
    },
  },
}));

import { prisma } from "@kannan19302/database";
import { TwoPersonControlGuard } from "../two-person-control.guard";
import { TWO_PERSON_CONTROL_KEY } from "../../decorators/two-person-control.decorator";
import { ControlPlaneAuditService } from "../../../platform/v1/control-plane-audit.service";

function ctx(user: any, headers: Record<string, string> = {}) {
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        user,
        method: "POST",
        url: "/platform/v1/offboarding/tenant-x/offboard",
        params: { tenantId: "tenant-x" },
        headers,
        ip: "127.0.0.1",
      }),
    }),
    getHandler: () => () => undefined,
    getClass: () => class {},
  } as any;
}

describe("TwoPersonControlGuard (C04 / D049)", () => {
  let guard: TwoPersonControlGuard;
  let reflector: Reflector;

  beforeEach(() => {
    vi.clearAllMocks();
    for (const k of Object.keys(approvals)) delete approvals[k];
    reviewTasks.length = 0;
    reflector = new Reflector();
    vi.spyOn(reflector, "getAllAndOverride").mockReturnValue(true);
    guard = new TwoPersonControlGuard(reflector, new ControlPlaneAuditService());
  });

  it("an approval self-requested and self-approved by the SAME actor is refused", async () => {
    approvals["tok-1"] = {
      id: "tok-1",
      requestedBy: "actor-1",
      approvedBy: "actor-1", // same person "approved" their own request
      status: "APPROVED",
      expiresAt: new Date(Date.now() + 60_000),
    };
    await expect(
      guard.canActivate(
        ctx({ userId: "actor-1" }, { "x-approval-token": "tok-1" }),
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it("an approval with no approvedBy at all (never actually approved by anyone) is refused", async () => {
    approvals["tok-2"] = {
      id: "tok-2",
      requestedBy: "actor-1",
      approvedBy: null,
      status: "APPROVED", // status flipped without a real approver — must not be trusted alone
      expiresAt: new Date(Date.now() + 60_000),
    };
    await expect(
      guard.canActivate(
        ctx({ userId: "actor-1" }, { "x-approval-token": "tok-2" }),
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it("a genuinely two-person approval — requested by one actor, approved by a DIFFERENT one — succeeds", async () => {
    approvals["tok-3"] = {
      id: "tok-3",
      requestedBy: "actor-1",
      approvedBy: "actor-2",
      status: "APPROVED",
      expiresAt: new Date(Date.now() + 60_000),
    };
    await expect(
      guard.canActivate(
        ctx({ userId: "actor-1" }, { "x-approval-token": "tok-3" }),
      ),
    ).resolves.toBe(true);
  });

  it("break-glass still works as the deliberate single-operator escape hatch, and creates a review task", async () => {
    const allowed = await guard.canActivate(
      ctx(
        { userId: "actor-1", realm: "provider" },
        { "x-break-glass-reason": "production incident, tenant unreachable" },
      ),
    );
    expect(allowed).toBe(true);
    expect(reviewTasks).toHaveLength(1);
    expect(reviewTasks[0]).toMatchObject({ actorId: "actor-1", status: "OPEN" });
  });
});
