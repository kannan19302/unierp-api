/**
 * M32 — step-up MFA for destructive plans. `verifyChallenge()` is what a
 * real MFA challenge-response flow (TOTP/WebAuthn) would call on
 * success; `consumeToken()` is what `StepUpMfaGuard` calls, and consumes
 * the token so it cannot be replayed across two separate destructive
 * requests. There is no code path that marks a request as step-up-MFA'd
 * without a verification row existing, unexpired, and unused.
 */
import { Injectable } from "@nestjs/common";
import { prisma } from "@kannan19302/database";

@Injectable()
export class StepUpMfaService {
  async issueVerifiedToken(userId: string, ttlMs = 5 * 60 * 1000): Promise<{ token: string; expiresAt: Date }> {
    const token = `mfa-${userId}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const expiresAt = new Date(Date.now() + ttlMs);
    await (prisma as any).stepUpMfaVerification.create({
      data: { userId, token, expiresAt },
    });
    return { token, expiresAt };
  }

  /**
   * Consumes the token — a second call with the same token fails, which
   * is what makes step-up MFA "unskippable": there is no way to reuse a
   * single successful challenge across multiple destructive calls, and
   * no token at all means the check fails outright, never defaults open.
   */
  async consumeToken(userId: string, token: string | undefined): Promise<boolean> {
    if (!token) return false;
    const verification = await (prisma as any).stepUpMfaVerification.findUnique({ where: { token } });
    if (!verification) return false;
    if (verification.userId !== userId) return false;
    if (verification.usedAt) return false;
    if (verification.expiresAt < new Date()) return false;

    await (prisma as any).stepUpMfaVerification.update({
      where: { token },
      data: { usedAt: new Date() },
    });
    return true;
  }
}
