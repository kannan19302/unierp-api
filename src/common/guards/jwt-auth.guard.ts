import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from "@nestjs/common";
import { idpClient } from "../idp-client";
import { runWithTenantSession } from "@kannan19302/database";
import { verifyBearerToken } from "./verify-bearer-token";

const AUTH_COOKIE = "auth_token";

/**
 * Mirrors idp's own guard (idp/src/common/guards/jwt-auth.guard.ts) — this is
 * the guard that actually sees the bulk of authenticated traffic, since most
 * app requests go to `api`, not to `idp` directly. Idle timeout only works if
 * BOTH guards touch `lastActivityAt`; touching it in only one leaves the
 * other's users idled out regardless of how active they actually are.
 */
const IDLE_TIMEOUT_MS = parseInt(
  process.env.SESSION_IDLE_TIMEOUT_MS || String(30 * 60 * 1000),
  10,
);

@Injectable()
export class JwtAuthGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();

    // 1. Prefer httpOnly cookie
    let token: string | undefined = request.cookies?.[AUTH_COOKIE];

    // 2. Fall back to Authorization header (backwards-compat during migration)
    if (!token) {
      const authHeader = request.headers.authorization;
      if (authHeader?.startsWith("Bearer ")) {
        token = authHeader.split(" ")[1];
      }
    }

    if (!token) {
      throw new UnauthorizedException("Missing authentication credentials");
    }

    // Purpose-scoped: a password-reset or MFA-challenge token carries a valid
    // signature but must never be accepted as a session. Accepts either the
    // legacy HS256 cookie session or an RS256 OIDC bearer access token — see
    // verify-bearer-token.ts for why both are legitimate here, and why this
    // guard specifically (not just idp's) has to accept both: this is the
    // guard that sees the OIDC access token every W6-wired platform and
    // mobile (W11) actually send on API calls.
    const decoded = await verifyBearerToken(token);
    if (!decoded) {
      throw new UnauthorizedException(
        "Invalid or expired authentication token",
      );
    }

    // 3. Revocable sessions. Every session token carries a session id, and that
    // session must still be active and unexpired.
    //
    // This check was removed during the platform split in favour of "stateless
    // validation", on the stated grounds that revocation would be handled by
    // "short token lifetimes or asynchronous invalidation lists". No invalidation
    // list exists anywhere in the repository, so the only remaining bound was the
    // access-token TTL — 15 minutes by default. That meant logging out, disabling
    // a user, or revoking a stolen session left the bearer fully authorised for up
    // to a quarter of an hour, with no way to intervene. For an emergency lockout
    // or a compromised administrator session that is the window that matters.
    //
    // Restored deliberately, at the cost of one indexed primary-key lookup per
    // request. Reinstate a stateless model only alongside a real denylist that is
    // actually consulted here.
    //
    // UserSession moved to the IdP schema in the split, so this reads through the
    // IdP client rather than the main one.
    //
    // `sid` is MANDATORY. It was previously optional, "for tokens minted before
    // sessions were tracked" — which meant any token without the claim skipped
    // revocation entirely. A checked-in server action in the provider console
    // exploited exactly that, minting `sid`-less wildcard tokens that could
    // never be revoked. A session token that cannot be revoked is not a session
    // token; reject it.
    if (!decoded.sid) {
      throw new UnauthorizedException(
        "Session token is missing a session id and cannot be revoked",
      );
    }

    // The lookup runs inside a tenant session derived from the token's own
    // claim, and it has to.
    //
    // user_sessions carries RLS with ENABLE + FORCE, and the application role
    // is NOBYPASSRLS. Querying it before any tenant context is established
    // returns zero rows — not "revoked", simply invisible — so this guard
    // rejected EVERY authenticated request with "Session has been revoked or
    // expired" while the row sat there active and unexpired. Authentication
    // could not work at all against a correctly-secured database; it only
    // appeared to work where RLS was unenforced or the connection was the
    // table owner.
    //
    // Using the token's tenantId is safe here even though the token is not yet
    // fully trusted: the signature has already been verified above, and the
    // context only widens visibility to that one tenant's own sessions. A
    // forged tenantId cannot help an attacker, because the session id must
    // still exist within it.
    const session = await runWithTenantSession(
      { tenantId: decoded.tenantId ?? "", userId: decoded.userId ?? "" },
      () =>
        idpClient.userSession.findUnique({
          where: { id: decoded.sid },
          select: { id: true, isActive: true, expiresAt: true, lastActivityAt: true },
        }),
    );
    const now = new Date();
    if (
      !session ||
      !session.isActive ||
      (session.expiresAt && session.expiresAt < now)
    ) {
      throw new UnauthorizedException("Session has been revoked or expired");
    }

    if (now.getTime() - session.lastActivityAt.getTime() > IDLE_TIMEOUT_MS) {
      await idpClient.userSession
        .update({ where: { id: session.id }, data: { isActive: false } })
        .catch(() => {});
      throw new UnauthorizedException("Session timed out due to inactivity");
    }

    idpClient.userSession
      .update({ where: { id: session.id }, data: { lastActivityAt: now } })
      .catch(() => {});

    request.user = decoded;
    return true;
  }
}
