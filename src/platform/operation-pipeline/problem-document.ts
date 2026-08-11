/**
 * M10 — RFC 7807 (application/problem+json) mapping for provider errors.
 * https://www.rfc-editor.org/rfc/rfc7807
 *
 * The exit criterion's second half: "no provider SDK error reaches the UI
 * unmapped." `mapProviderError` is total over `unknown` — every input,
 * however malformed, produces a ProblemDocument. There is no code path
 * that lets a raw error object escape this function; the final branch is
 * a catch-all, not an unreachable default.
 */
export interface ProblemDocument {
  type: string;
  title: string;
  status: number;
  detail: string;
  instance?: string;
  /** Not part of RFC 7807 itself — this platform's extension, the
   *  operator-actionable remediation the exit criterion requires. */
  remediation: string;
}

interface ErrorShape {
  code?: string;
  status?: number;
  statusCode?: number;
  message?: string;
}

function asErrorShape(err: unknown): ErrorShape {
  if (err && typeof err === "object") return err as ErrorShape;
  return {};
}

export function mapProviderError(err: unknown, instance?: string): ProblemDocument {
  const shape = asErrorShape(err);
  const message = shape.message ?? (typeof err === "string" ? err : String(err));
  const status = shape.status ?? shape.statusCode;
  const code = shape.code;

  if (code === "ECONNREFUSED" || code === "ENOTFOUND" || code === "ETIMEDOUT" || code === "EHOSTUNREACH") {
    return {
      type: "https://unierp.dev/problems/provider-unreachable",
      title: "Provider unreachable",
      status: 502,
      detail: message,
      instance,
      remediation: `Verify the provider's host/network configuration and that it is reachable from this environment (code: ${code}).`,
    };
  }

  if (code === "EAUTH" || status === 401 || status === 403) {
    return {
      type: "https://unierp.dev/problems/provider-authentication-failed",
      title: "Provider authentication failed",
      status: 401,
      detail: message,
      instance,
      remediation: "Rotate the provider's credential (M03) — the current one was rejected. Check for recent expiry.",
    };
  }

  if (status === 429) {
    return {
      type: "https://unierp.dev/problems/provider-rate-limited",
      title: "Provider rate limit exceeded",
      status: 429,
      detail: message,
      instance,
      remediation: "Reduce call volume or raise the provider's recorded quota (M04) if it now supports a higher limit.",
    };
  }

  if (status && status >= 500) {
    return {
      type: "https://unierp.dev/problems/provider-internal-error",
      title: "Provider reported an internal error",
      status: 502,
      detail: message,
      instance,
      remediation: "This is the provider's own fault, not a configuration issue. Retry; escalate to the vendor if it persists.",
    };
  }

  if (status && status >= 400) {
    return {
      type: "https://unierp.dev/problems/provider-rejected-request",
      title: "Provider rejected the request",
      status,
      detail: message,
      instance,
      remediation: "The request sent to the provider was malformed or invalid for its API — check the operation's input fields.",
    };
  }

  // Catch-all: this is the branch that makes the function total. An error
  // with no recognisable shape at all still becomes a typed document,
  // never a raw throw reaching the caller.
  return {
    type: "https://unierp.dev/problems/provider-error-unclassified",
    title: "Unclassified provider error",
    status: 502,
    detail: message,
    instance,
    remediation: "This error shape was not recognised. File it under 90-DEFECT-LOG.md so a specific mapping can be added.",
  };
}
