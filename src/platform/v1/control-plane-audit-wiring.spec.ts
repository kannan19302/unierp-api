/**
 * C03 exit criterion, re-verified during the Track M foundation sweep: "No
 * console mutation is possible without an audit record; verified by a test
 * that attempts one. Audit records are append-only and tamper-evident."
 *
 * `control-plane-audit.spec.ts` proves `ControlPlaneAuditService` itself is
 * correct in isolation. It never proved the service was CALLED. It was not:
 * zero of 22 mounted plane-1 controllers invoked it, and it was not
 * registered as a global interceptor. `@TrackChanges(...)` on ten
 * controllers was inert `SetMetadata` — `ChangeHistoryInterceptor` only acts
 * on it via a per-handler `@UseInterceptors(...)` none of them carried.
 * `AuditInterceptor`, the only thing that DID run globally, writes to the
 * plain non-chained `audit_logs` table and skips entirely when
 * `user.tenantId` is absent — which every control-plane session satisfies.
 * Filed as D048; this file is that phase's regression coverage.
 *
 * FIX: `ControlPlaneAuditInterceptor` (common/interceptors/) now runs
 * globally and calls `ControlPlaneAuditService.record()` for every mutating
 * request on a `@SkipTenantScope()` handler — the same marker
 * `ControlPlaneGuard` uses to identify plane-1 routes, so new controllers are
 * covered automatically. Registered in app.module.ts.
 *
 * Residual, stated rather than hidden: this is a post-hoc write, same as
 * `AuditInterceptor`. It guarantees an audit-write attempt for every
 * successful mutation; it does not give the mutation and its audit record a
 * shared transaction, which only per-service `tx`-threading across all 22
 * controllers can deliver, and which was judged too large to attempt
 * un-integration-tested in this session. See the interceptor's own docstring.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

const PLATFORM_DIR = join(__dirname, "..");
const V1_DIR = __dirname;
const APP_MODULE = join(__dirname, "..", "..", "app.module.ts");

function mountedControllerFiles(): string[] {
  const modSrc = readFileSync(join(PLATFORM_DIR, "platform.module.ts"), "utf8");
  const block = /controllers:\s*\[([\s\S]*?)\]/.exec(modSrc);
  const mounted = new Set(
    [...(block?.[1].matchAll(/\b(\w+Controller)\b/g) ?? [])].map((m) => m[1]),
  );
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
    );
  return walk(V1_DIR).filter((f) => {
    if (!f.endsWith(".controller.ts")) return false;
    const src = readFileSync(f, "utf8");
    return [...src.matchAll(/export class (\w+Controller)\b/g)].some((m) =>
      mounted.has(m[1]),
    );
  });
}

describe("C03 · control-plane audit — is the mechanism actually wired?", () => {
  it("ControlPlaneAuditInterceptor is registered as a global APP_INTERCEPTOR", () => {
    const appModule = readFileSync(APP_MODULE, "utf8");
    const interceptorBlock = [
      ...appModule.matchAll(/\{\s*provide:\s*APP_INTERCEPTOR[^}]*\}/g),
    ]
      .map((m) => m[0])
      .join("\n");
    expect(
      /ControlPlaneAuditInterceptor/.test(interceptorBlock),
      "app.module.ts must register ControlPlaneAuditInterceptor as a global " +
        "APP_INTERCEPTOR — otherwise no plane-1 controller's mutations produce " +
        "a tamper-evident record no matter what any individual controller does.",
    ).toBe(true);
  });

  it("ControlPlaneAuditInterceptor reads SKIP_TENANT_SCOPE_KEY and calls ControlPlaneAuditService.record", () => {
    const src = readFileSync(
      join(
        __dirname,
        "..",
        "..",
        "common",
        "interceptors",
        "control-plane-audit.interceptor.ts",
      ),
      "utf8",
    );
    expect(src, "must gate on the same marker ControlPlaneGuard uses").toMatch(
      /SKIP_TENANT_SCOPE_KEY/,
    );
    expect(src, "must actually call the tamper-evident service").toMatch(
      /this\.audit\.record\(/,
    );
    expect(
      src,
      "must not silently swallow a failed audit write the way AuditInterceptor does — error, not warn",
    ).toMatch(/pinoLogger\.error\(/);
  });

  it("no mounted plane-1 controller uses @TrackChanges — it is the wrong mechanism there, not just an unwired one", () => {
    // ChangeHistoryInterceptor keys every record on `user.tenantId`
    // (change-history.interceptor.ts:43). For a plane-1 request that is the
    // ACTOR's tenant, not the tenant being acted on — and a provider-staff
    // session's tenantId is the reserved seeding tenant ("platform",
    // seed-platform.ts PLATFORM_TENANT_ID), never undefined. Wiring the
    // interceptor here would not no-op; it would misfile every plane-1
    // change record under the reserved tenant and leave the actual target
    // tenant's history silently blind to what a provider operator changed —
    // confidently wrong data, worse than the inert decorator it would replace.
    const users: string[] = [];
    for (const file of mountedControllerFiles()) {
      if (/@TrackChanges\(/.test(readFileSync(file, "utf8"))) {
        users.push(file.slice(V1_DIR.length + 1));
      }
    }
    expect(users).toEqual([]);
  });
});
