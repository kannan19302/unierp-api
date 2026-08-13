import { ExecutionContext, ForbiddenException } from "@nestjs/common";
import { TwoPersonControlGuard } from "../two-person-control.guard";
import { TWO_PERSON_CONTROL_KEY } from "../../decorators/two-person-control.decorator";
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@kannan19302/database", () => {
  return {
    prisma: {
      controlPlaneApproval: {
        findUnique: vi.fn(),
        update: vi.fn(),
      },
      controlPlaneReviewTask: {
        create: vi.fn(),
      },
    },
  };
});

const mockAuditService = {
  record: vi.fn(),
};

describe("TwoPersonControlGuard (C04 Exit Criterion)", () => {
  let guard: TwoPersonControlGuard;
  let mockReflector: { getAllAndOverride: ReturnType<typeof vi.fn> };

  let mockPrisma: any;

  beforeEach(async () => {
    // get access to the hoisted mock
    const db = await import("@kannan19302/database");
    mockPrisma = db.prisma;
    
    mockReflector = { getAllAndOverride: vi.fn() };
    guard = new TwoPersonControlGuard(
      mockReflector as any,
      mockAuditService as any,
    );
    vi.clearAllMocks();
  });

  function createMockContext(
    headers: Record<string, string>,
    user?: any,
  ): ExecutionContext {
    return {
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({
        getRequest: () => ({
          headers,
          user: user || { userId: "operator-1", realm: "provider" },
          method: "POST",
          url: "/platform/v1/tenants/t-1/purge",
          ip: "127.0.0.1",
          params: { id: "t-1" },
        }),
      }),
    } as any;
  }

  // Gate 1: Normal operations (no decorator) are allowed
  it("allows operations not marked with @TwoPersonControl", async () => {
    mockReflector.getAllAndOverride.mockReturnValue(false);
    const ctx = createMockContext({});
    const result = await guard.canActivate(ctx);
    expect(result).toBe(true);
  });

  // Gate 2: Destructive operations without approval/break-glass are rejected
  it("rejects destructive operations without approval or break-glass", async () => {
    mockReflector.getAllAndOverride.mockReturnValue(true);
    const ctx = createMockContext({});
    
    await expect(guard.canActivate(ctx)).rejects.toThrow(
      ForbiddenException,
    );
    await expect(guard.canActivate(ctx)).rejects.toThrow(
      "Two-person approval or break-glass reason required",
    );
  });

  // Gate 3: Valid approval token allows operation
  it("allows operation with a valid approval token", async () => {
    mockReflector.getAllAndOverride.mockReturnValue(true);
    const ctx = createMockContext({
      "x-approval-token": "token-123",
    });

    mockPrisma.controlPlaneApproval.findUnique.mockResolvedValue({
      id: "token-123",
      status: "APPROVED",
      requestedBy: "operator-1",
      approvedBy: "operator-2", // a genuinely different second person (M49 / D049)
      expiresAt: new Date(Date.now() + 10000), // future
    });

    const result = await guard.canActivate(ctx);
    expect(result).toBe(true);
    
    // Verifies the token was marked used
    expect(mockPrisma.controlPlaneApproval.update).toHaveBeenCalledWith({
      where: { id: "token-123" },
      data: { status: "USED" },
    });
  });

  // Gate 4: Invalid approval token is rejected (e.g. wrong user, expired, unapproved)
  it("rejects operation with expired approval token", async () => {
    mockReflector.getAllAndOverride.mockReturnValue(true);
    const ctx = createMockContext({ "x-approval-token": "token-123" });

    mockPrisma.controlPlaneApproval.findUnique.mockResolvedValue({
      id: "token-123",
      status: "APPROVED",
      requestedBy: "operator-1",
      expiresAt: new Date(Date.now() - 10000), // past
    });

    await expect(guard.canActivate(ctx)).rejects.toThrow("Approval token expired");
  });

  // Gate 5: Break-glass raises a review task and allows operation
  it("allows operation with break-glass reason and raises review task", async () => {
    mockReflector.getAllAndOverride.mockReturnValue(true);
    const ctx = createMockContext({
      "x-break-glass-reason": "Urgent outage requires immediate purge",
    });

    const result = await guard.canActivate(ctx);
    expect(result).toBe(true);

    // Verifies the review task was created
    expect(mockPrisma.controlPlaneReviewTask.create).toHaveBeenCalledWith({
      data: {
        actorId: "operator-1",
        action: "POST /platform/v1/tenants/t-1/purge",
        targetId: "t-1",
        reason: "Urgent outage requires immediate purge",
      },
    });

    // Verifies audit record was created for the break-glass event
    expect(mockAuditService.record).toHaveBeenCalledWith({
      actorId: "operator-1",
      actorRole: "provider",
      action: "break-glass.used",
      details: {
        route: "POST /platform/v1/tenants/t-1/purge",
        reason: "Urgent outage requires immediate purge",
      },
      correlationId: undefined,
      ipAddress: "127.0.0.1",
    });
  });

  // Gate 6: Break-glass requires a substantial reason
  it("rejects break-glass with a trivial reason", async () => {
    mockReflector.getAllAndOverride.mockReturnValue(true);
    const ctx = createMockContext({
      "x-break-glass-reason": "fix", // Too short
    });

    await expect(guard.canActivate(ctx)).rejects.toThrow(
      "Break-glass reason must be at least 10 characters",
    );
  });
});
