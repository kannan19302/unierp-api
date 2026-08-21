import { verifyTypedToken, TOKEN_TYPE } from "@kannan19302/auth";
import { createRemoteJWKSet, jwtVerify } from "jose";

export interface VerifiedClaims {
  sid?: string;
  tenantId?: string;
  userId?: string;
  realm?: "tenant" | "provider";
  roles?: string[];
  permissions?: string[];
  mfaVerified?: boolean;
  [key: string]: unknown;
}

/**
 * Mirrors idp/src/common/guards/verify-bearer-token.ts — same two token
 * shapes, same normalisation.
 *
 * The issuer and the JWKS location are deliberately SEPARATE settings,
 * because they are different things and conflating them silently broke every
 * OIDC-authenticated call to this service:
 *
 *   OIDC_ISSUER    is an IDENTITY. It must equal the `iss` claim idp stamps
 *                  and publishes in its discovery document verbatim — RFC 8414
 *                  has clients compare it as an opaque string. Browsers reach
 *                  idp on localhost:3005, so that is the identity it publishes.
 *   OIDC_JWKS_URL  is a NETWORK ADDRESS. From inside compose this service
 *                  cannot resolve `localhost:3005` (that is its own container),
 *                  so it fetches the keys at `http://idp:3005` instead.
 *
 * Previously both were read from OIDC_ISSUER, set to `http://idp:3005` so the
 * JWKS fetch would work — which made every `iss` check fail against tokens
 * stamped `http://localhost:3005`, and every RS256 token was rejected with a
 * bare 401 that looked like an expired session.
 */
const OIDC_ISSUER = process.env.OIDC_ISSUER ?? "http://localhost:3005";
const jwks = createRemoteJWKSet(
  new URL(process.env.OIDC_JWKS_URL ?? `${OIDC_ISSUER}/oidc/jwks.json`),
);

export async function verifyBearerToken(token: string): Promise<VerifiedClaims | null> {
  const legacy = verifyTypedToken<VerifiedClaims>(token, TOKEN_TYPE.SESSION);
  if (legacy) return legacy;

  try {
    const { payload } = await jwtVerify(token, jwks, {
      issuer: OIDC_ISSUER,
    });
    if (payload.typ !== "session" || !payload.sub) return null;
    return {
      ...payload,
      userId: payload.sub,
    } as VerifiedClaims;
  } catch {
    return null;
  }
}
