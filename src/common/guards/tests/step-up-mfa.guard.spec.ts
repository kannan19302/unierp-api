/**
 * M32 exit criterion (MFA half): "Step-up MFA is unskippable on a
 * destructive plan — asserted by attempting one without it and expecting
 * 403."
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ForbiddenException } from "@nestjs/common";

let verifications: any[];
let seq = 0;
const nextId = (p: string) => `${p}-${++seq}`;

vi.mock("@kannan19302/database", () => ({
  prisma: {
    stepUpMfaVerification: {
      create: vi.fn(({ data }: any) => {
        const row = { id: nextId("mfa"), usedAt: null, ...data };
        verifications.push(row);
        return row;
      }),
      findUnique: vi.fn(({ where: { token } }: any) => verifications.find((v) => v.token === token) ?? null),
      update: vi.fn(({ where: { token }, data }: any) => {
        const row = verifications.find((v) => v.token === token)!;
        Object.assign(row, data);
        return row;
      }),
    },
  },
}));

import { StepUpMfaService } from "../../services/step-up-mfa.service";
import { StepUpMfaGuard } from "../step-up-mfa.guard";

function makeContext(user: any, headers: Record<string, string>) {
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({
      getRequest: () => ({ user, headers }),
    }),
  } as any;
}

function makeGuard(mfa: StepUpMfaService, required: boolean): StepUpMfaGuard {
  const reflector = { getAllAndOverride: () => required };
  return new StepUpMfaGuard(reflector as any, mfa);
}

describe("M32 · StepUpMfaGuard", () => {
  let mfa: StepUpMfaService;

  beforeEach(() => {
    vi.clearAllMocks();
    verifications = [];
    mfa = new StepUpMfaService();
  });

  it("step-up MFA is UNSKIPPABLE on a destructive plan: attempting one without a token is refused with 403 (ForbiddenException)", async () => {
    const guard = makeGuard(mfa, true);
    const context = makeContext({ userId: "op-1" }, {});
    await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
  });

  it("an expired or unknown token is refused, not silently accepted", async () => {
    const guard = makeGuard(mfa, true);
    const context = makeContext({ userId: "op-1" }, { "x-step-up-mfa-token": "does-not-exist" });
    await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
  });

  it("a valid, unexpired, unused token passes -- and cannot be reused for a second destructive call", async () => {
    const guard = makeGuard(mfa, true);
    const { token } = await mfa.issueVerifiedToken("op-1");
    const context = makeContext({ userId: "op-1" }, { "x-step-up-mfa-token": token });

    expect(await guard.canActivate(context)).toBe(true);

    // Replay: the exact same token on a second destructive request.
    await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
  });

  it("a token issued to a different user is refused", async () => {
    const guard = makeGuard(mfa, true);
    const { token } = await mfa.issueVerifiedToken("op-1");
    const context = makeContext({ userId: "op-attacker" }, { "x-step-up-mfa-token": token });
    await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
  });

  it("a route not marked @RequireStepUpMfa() is unaffected", async () => {
    const guard = makeGuard(mfa, false);
    const context = makeContext({ userId: "op-1" }, {});
    expect(await guard.canActivate(context)).toBe(true);
  });
});
