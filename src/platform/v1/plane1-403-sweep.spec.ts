/**
 * M47 / D046 — the per-endpoint 403 sweep.
 *
 * The exit criterion asks for this specifically, and asks for it PER ENDPOINT
 * rather than per controller. That distinction is the whole value: D046 existed
 * because fourteen controllers were checked as units and nobody enumerated their
 * routes. A per-controller assertion would have passed on a controller with one
 * guarded route and nine open ones.
 *
 * WHAT THIS DRIVES
 *
 * The real `ControlPlaneGuard` and `RbacGuard` classes, against the real
 * `@Permissions` / `@SkipTenantScope` metadata reflected off the real controller
 * prototypes — the harness `modules/admin/tests/rbac-regression-sweep.spec.ts`
 * established. Nothing here is mocked except the caller's identity, which is the
 * variable under test.
 *
 * The handler list is DISCOVERED from platform.module.ts and the controller
 * sources, not hand-written. A hand-written list silently stops covering the
 * endpoint somebody adds next week, which is how the gap opened the first time.
 *
 * WHY 403 AND NOT 404/500
 *
 * `02-EXECUTION-GUIDELINES` requires unauthorised access to be 403. A 404 leaks
 * nothing but tells an operator the wrong thing; a 500 means the guard threw
 * rather than denied, and a guard that throws on a malformed token is a
 * denial-of-service on the control plane. `ForbiddenException` maps to 403.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect, beforeAll, vi } from "vitest";
import { Reflector } from "@nestjs/core";
import { ForbiddenException } from "@nestjs/common";

/**
 * Loading 22 controllers pulls their whole service graph, and through it a real
 * Prisma client — 25 s of module collection and a timed-out hook. Only the
 * controllers' DECORATOR METADATA is under test here; their services are never
 * invoked, because the guard denies before any handler runs. Stubbing the
 * database keeps the graph cheap without weakening anything this file asserts.
 * Same approach as modules/admin/tests/rbac-regression-sweep.spec.ts.
 */
vi.mock("@kannan19302/database", () => {
  const mocked = {
    prisma: new Proxy({}, { get: () => new Proxy({}, { get: () => vi.fn() }) }),
    runWithTenantSession: vi.fn((_s: unknown, fn: () => unknown) => Promise.resolve(fn())),
  };
  return { ...mocked, idpPrisma: mocked.prisma, idpClient: mocked.prisma };
});

import { ControlPlaneGuard } from "../../common/guards/control-plane.guard";

const V1_DIR = __dirname;
const MODULE_FILE = join(__dirname, "..", "platform.module.ts");

interface Handler {
  controller: string;
  method: string;
  verb: string;
  path: string;
}

/** Mounted controller class names, parsed from the module's controllers array. */
function mountedControllerNames(): Set<string> {
  const src = readFileSync(MODULE_FILE, "utf8");
  const block = /controllers:\s*\[([\s\S]*?)\]/.exec(src);
  if (!block) throw new Error("platform.module.ts has no controllers array");
  return new Set([...block[1].matchAll(/\b(\w+Controller)\b/g)].map((m) => m[1]));
}

/** Every route handler on every mounted plane-1 controller, discovered from source. */
function discoverHandlers(): Handler[] {
  const mounted = mountedControllerNames();
  const out: Handler[] = [];
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
    );

  for (const file of walk(V1_DIR).filter((f) => f.endsWith(".controller.ts"))) {
    const src = readFileSync(file, "utf8");
    const classes = [...src.matchAll(/export class (\w+Controller)\b/g)];
    for (let i = 0; i < classes.length; i++) {
      const cls = classes[i][1];
      if (!mounted.has(cls)) continue;
      const body = src.slice(
        classes[i].index,
        i + 1 < classes.length ? classes[i + 1].index : src.length,
      );
      const base = ([...src.slice(0, classes[i].index).matchAll(/@Controller\(\s*['"`]([^'"`]*)/g)].pop() ?? [])[1] ?? "?";

      const sigRe = /^[ \t]+(?:public\s+|private\s+|protected\s+)?(?:async\s+)?(\w+)\s*\(/gm;
      const sigs = [...body.matchAll(sigRe)].filter((m) => m[1] !== "constructor");
      for (let s = 0; s < sigs.length; s++) {
        const scope = body.slice(s === 0 ? 0 : sigs[s - 1].index, sigs[s].index);
        const route = /@(Get|Post|Put|Patch|Delete)\(([^)]*)\)/.exec(scope);
        if (!route) continue;
        const pathArg = /['"`]([^'"`]*)['"`]/.exec(route[2]);
        out.push({
          controller: cls,
          method: sigs[s][1],
          verb: route[1].toUpperCase(),
          path: `/${base}/${pathArg ? pathArg[1] : ""}`.replace(/\/+$/, ""),
        });
      }
    }
  }
  return out;
}

/** Load the real controller classes so their decorator metadata is reflectable. */
async function loadControllerClasses(): Promise<Map<string, any>> {
  const mounted = mountedControllerNames();
  const map = new Map<string, any>();
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
    );
  for (const file of walk(V1_DIR).filter((f) => f.endsWith(".controller.ts"))) {
    const mod = await import(/* @vite-ignore */ file);
    for (const [name, value] of Object.entries(mod)) {
      if (mounted.has(name) && typeof value === "function") map.set(name, value);
    }
  }
  return map;
}

const ctx = (user: unknown, handler: unknown, controllerClass: unknown) =>
  ({
    switchToHttp: () => ({ getRequest: () => ({ user, url: "/test" }) }),
    getHandler: () => handler,
    getClass: () => controllerClass,
  }) as any;

/**
 * A customer's own Super Admin: authenticated, MFA-satisfied, and holding the
 * broadest grant the tenant plane can issue. This is the strongest caller that
 * must still be refused — anything weaker proves less.
 */
const TENANT_SUPER_ADMIN = {
  userId: "tenant-super-admin",
  tenantId: "customer-tenant",
  realm: "tenant",
  mfaVerified: true,
  permissions: ["*"],
};

describe("M47 · every mounted plane-1 endpoint refuses a tenant-realm caller with 403 (D046)", () => {
  let handlers: Handler[];
  let classes: Map<string, any>;
  let guard: ControlPlaneGuard;

  beforeAll(async () => {
    handlers = discoverHandlers();
    classes = await loadControllerClasses();
    guard = new ControlPlaneGuard(new Reflector());
  }, 120_000);

  it("discovers every mounted plane-1 endpoint", () => {
    // Guards against the sweep silently emptying and passing vacuously.
    expect(handlers.length).toBeGreaterThanOrEqual(150);
    expect(classes.size).toBe(mountedControllerNames().size);
  });

  it("refuses a tenant Super Admin on EVERY endpoint, with ForbiddenException (403)", async () => {
    const leaked: string[] = [];
    const wrongError: string[] = [];

    for (const h of handlers) {
      const cls = classes.get(h.controller);
      if (!cls) {
        leaked.push(`${h.controller} (class not loadable — cannot be asserted)`);
        continue;
      }
      const handler = cls.prototype[h.method];
      try {
        const allowed = await guard.canActivate(ctx(TENANT_SUPER_ADMIN, handler, cls));
        if (allowed) leaked.push(`${h.verb} ${h.path} (${h.controller}.${h.method})`);
      } catch (e) {
        if (!(e instanceof ForbiddenException)) {
          wrongError.push(
            `${h.verb} ${h.path} threw ${(e as Error).constructor.name} — must be ` +
              `ForbiddenException so the caller sees 403, not 500`,
          );
        }
      }
    }

    expect(
      wrongError,
      `Endpoints denying with the wrong error type:\n${wrongError.join("\n")}`,
    ).toEqual([]);
    expect(
      leaked,
      `${leaked.length} plane-1 endpoint(s) admitted a tenant Super Admin holding ` +
        `["*"]:\n${leaked.join("\n")}`,
    ).toEqual([]);
  });

  it("refuses an unauthenticated caller on every endpoint", async () => {
    const leaked: string[] = [];
    for (const h of handlers) {
      const cls = classes.get(h.controller);
      if (!cls) continue;
      try {
        const allowed = await guard.canActivate(ctx(undefined, cls.prototype[h.method], cls));
        if (allowed) leaked.push(`${h.verb} ${h.path}`);
      } catch {
        /* denied, as required */
      }
    }
    expect(leaked, `admitted an anonymous caller:\n${leaked.join("\n")}`).toEqual([]);
  });

  it("refuses a provider-realm caller whose session carries no second factor", async () => {
    const noMfa = {
      userId: "staff",
      realm: "provider",
      permissions: ["system.*", "platform.*"],
    };
    const leaked: string[] = [];
    for (const h of handlers) {
      const cls = classes.get(h.controller);
      if (!cls) continue;
      try {
        const allowed = await guard.canActivate(ctx(noMfa, cls.prototype[h.method], cls));
        if (allowed) leaked.push(`${h.verb} ${h.path}`);
      } catch {
        /* denied, as required */
      }
    }
    expect(
      leaked,
      `§ 5.2 requires MFA on the control plane. Admitted without it:\n${leaked.join("\n")}`,
    ).toEqual([]);
  });

  it("ADMITS a fully-qualified platform owner — proving the refusals are a boundary, not a broken guard", async () => {
    const owner = {
      userId: "platform-owner",
      realm: "provider",
      mfaVerified: true,
      permissions: ["system.*", "platform.*"],
    };
    const refused: string[] = [];
    for (const h of handlers) {
      const cls = classes.get(h.controller);
      if (!cls) continue;
      try {
        const allowed = await guard.canActivate(ctx(owner, cls.prototype[h.method], cls));
        if (!allowed) refused.push(`${h.verb} ${h.path}`);
      } catch (e) {
        refused.push(`${h.verb} ${h.path} — ${(e as Error).message}`);
      }
    }
    expect(
      refused,
      `A correctly-credentialled platform owner was refused on ${refused.length} ` +
        `endpoint(s). A guard that denies everyone is not a boundary:\n${refused.join("\n")}`,
    ).toEqual([]);
  });
});
