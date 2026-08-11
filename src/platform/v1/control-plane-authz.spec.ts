/**
 * M47 / D046 — the plane-1 authorisation boundary, asserted rather than assumed.
 *
 * Two independent holes were found by the Track M foundation audit, and this file
 * covers the half that is pure logic. The other half — "every mounted endpoint
 * declares a permission and a guard chain" — is a static property of the source and
 * is enforced by `scripts/check-platform-permissions.mjs`, because a runtime test
 * can only see the routes it thinks to ask about, while the script sees all of them.
 *
 * THE HOLE THIS FILE CLOSES
 *
 * `CONTROL_PLANE_NAMESPACES` was `["system", "platform"]`. Seventy-two mounted
 * cross-tenant endpoints — enterprise-scale (38), feature-flags-metering (22),
 * cluster-routing (4), reseller-channel (4), white-label (4) — are guarded by
 * `saas.*` permissions, which that list does not cover. `hasPermission` therefore
 * treated `saas.clusters.read` as a tenant-scoped code, and a tenant SUPER_ADMIN
 * seeded with `["*"]` satisfied it.
 *
 * The comment above `CONTROL_PLANE_NAMESPACES` states the intent exactly:
 *   "`*` means 'everything in MY tenant', never 'everything on the platform'."
 * The list implemented that intent for two namespaces out of three.
 *
 * C02's exit criterion asked only that a wildcard not satisfy `platform.*` or
 * `system.*`. It was true, and it was true of a namespace almost nothing used —
 * which is why C02 could be marked DONE while 72 endpoints stayed reachable.
 * This suite asserts the property over the permissions the platform ACTUALLY
 * guards its routes with, discovered from source, so a new namespace cannot be
 * introduced without either being covered or failing here.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { hasPermission, CONTROL_PLANE_NAMESPACES } from "@kannan19302/shared";

const PLATFORM_DIR = join(__dirname, "..");
const V1_DIR = __dirname;

/** Controllers actually mounted — parsed from the module, not from the directory. */
function mountedControllers(): Set<string> {
  const src = readFileSync(join(PLATFORM_DIR, "platform.module.ts"), "utf8");
  const block = /controllers:\s*\[([\s\S]*?)\]/.exec(src);
  if (!block) throw new Error("platform.module.ts has no controllers array");
  return new Set([...block[1].matchAll(/\b(\w+Controller)\b/g)].map((m) => m[1]));
}

/** Every permission string guarding a mounted plane-1 controller. */
function permissionsGuardingPlaneOne(): string[] {
  const mounted = mountedControllers();
  const out = new Set<string>();
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
    );

  for (const file of walk(V1_DIR).filter((f) => f.endsWith(".controller.ts"))) {
    const src = readFileSync(file, "utf8");
    const classes = [...src.matchAll(/export class (\w+Controller)\b/g)];
    for (let i = 0; i < classes.length; i++) {
      if (!mounted.has(classes[i][1])) continue;
      const body = src.slice(
        classes[i].index,
        i + 1 < classes.length ? classes[i + 1].index : src.length,
      );
      for (const m of body.matchAll(/@Permissions\(([^)]*)\)/g)) {
        for (const s of m[1].matchAll(/['"`]([^'"`]+)['"`]/g)) out.add(s[1]);
      }
    }
  }
  return [...out].sort();
}

describe("M47 · plane-1 authorisation boundary (D046)", () => {
  const TENANT_SUPER_ADMIN = ["*"];

  it("discovers the permissions that guard mounted plane-1 routes", () => {
    const perms = permissionsGuardingPlaneOne();
    // If this ever reaches zero the suite below would pass vacuously, which is the
    // failure mode this programme exists to eliminate.
    expect(perms.length).toBeGreaterThan(50);
  });

  it("a tenant SUPER_ADMIN wildcard satisfies NO permission guarding a plane-1 route", () => {
    const granted = permissionsGuardingPlaneOne().filter((p) =>
      hasPermission(TENANT_SUPER_ADMIN, p),
    );
    expect(
      granted,
      `A tenant-scoped ["*"] grant satisfied ${granted.length} control-plane ` +
        `permission(s). '*' means everything in MY tenant, never everything on ` +
        `the platform. Offending codes: ${granted.join(", ")}`,
    ).toEqual([]);
  });

  it("every namespace used to guard a plane-1 route is a control-plane namespace", () => {
    const namespaces = [
      ...new Set(permissionsGuardingPlaneOne().map((p) => p.split(".")[0])),
    ].sort();
    const uncovered = namespaces.filter(
      (ns) => !(CONTROL_PLANE_NAMESPACES as readonly string[]).includes(ns),
    );
    expect(
      uncovered,
      `Namespace(s) ${uncovered.join(", ")} guard cross-tenant routes but are not in ` +
        `CONTROL_PLANE_NAMESPACES (${CONTROL_PLANE_NAMESPACES.join(", ")}), so ` +
        `hasPermission treats them as tenant-scoped and a wildcard satisfies them.`,
    ).toEqual([]);
  });

  it("an explicit control-plane grant still works — the fix must not deny staff", () => {
    expect(hasPermission(["system.tenant.read"], "system.tenant.read")).toBe(true);
    expect(hasPermission(["saas.*"], "saas.clusters.read")).toBe(true);
    expect(hasPermission(["system.*"], "system.tenant.offboard")).toBe(true);
  });

  it("a tenant wildcard still satisfies tenant-scoped permissions — no over-correction", () => {
    expect(hasPermission(TENANT_SUPER_ADMIN, "finance.invoice.create")).toBe(true);
    expect(hasPermission(TENANT_SUPER_ADMIN, "hr.employee.read")).toBe(true);
  });
});
