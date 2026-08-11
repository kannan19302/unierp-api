#!/usr/bin/env node
/**
 * check-platform-permissions.mjs — the plane-1 authorisation gate.
 *
 * Every endpoint mounted under /platform/v1 acts across tenant boundaries: it takes a
 * tenantId from the URL and operates on that tenant. A missing authorisation decorator
 * there is not a lint nit, it is a cross-tenant hole. D046 is what that looked like:
 * 54 of 156 mounted endpoints — including tenant offboarding, session revocation,
 * platform rollback and the whole invoicing surface — carried no @Permissions and no
 * @UseGuards, while the only global APP_GUARD (TenantThrottlerGuard) rate-limited them
 * and authorised nobody.
 *
 * C02's exit criterion already said "every console endpoint carries an explicit
 * control-plane permission". It was marked DONE without ever being run. This script is
 * that criterion, executable.
 *
 * WHAT IT CHECKS, and why it is built this way:
 *
 *   1. The mounted set comes from the `controllers:` array in platform.module.ts — not
 *      from a directory listing. During the D046 audit a filename sweep over-counted by
 *      5 endpoints (tenant-migration.controller.ts defines a class whose name does not
 *      match its filename) and a name guess under-counted by the same 5. A file on disk
 *      is not a route; only a mounted controller is.
 *
 *   2. Authorisation is checked PER ROUTE METHOD, not per controller. A controller with
 *      @Permissions on nine of ten routes is the failure mode this class of bug actually
 *      takes once someone starts fixing it by hand.
 *
 *   3. A route needs BOTH an explicit @Permissions(...) AND a guard chain that can
 *      enforce it. @Permissions without RbacGuard is metadata nothing reads — the exact
 *      "claim that outlived its mechanism" shape this codebase is prone to.
 *
 * Usage:
 *   node scripts/check-platform-permissions.mjs           # gate: exit 1 on any violation
 *   node scripts/check-platform-permissions.mjs --list    # print every mounted endpoint
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PLATFORM = join(ROOT, "src", "platform");
const MODULE_FILE = join(PLATFORM, "platform.module.ts");
const V1 = join(PLATFORM, "v1");

const LIST = process.argv.includes("--list");

/** Guards that can actually enforce a @Permissions grant on a control-plane route. */
const REQUIRED_GUARDS = ["JwtAuthGuard", "RbacGuard", "ControlPlaneGuard"];

const fail = (m) => violations.push(m);
const violations = [];

if (!existsSync(MODULE_FILE)) {
  console.error(`FAIL  ${MODULE_FILE} not found. The mounted set cannot be resolved.`);
  process.exit(1);
}

// ── 1. the mounted set ────────────────────────────────────────────────────────
const moduleSrc = readFileSync(MODULE_FILE, "utf8");
const controllersBlock = /controllers:\s*\[([\s\S]*?)\]/.exec(moduleSrc);
if (!controllersBlock) {
  console.error(
    `FAIL  platform.module.ts has no controllers: [...] array. Either the module was ` +
      `restructured or this gate is reading the wrong file — both mean the gate cannot ` +
      `see what is mounted, so it fails rather than passing vacuously.`,
  );
  process.exit(1);
}
const mounted = new Set(
  [...controllersBlock[1].matchAll(/\b(\w+Controller)\b/g)].map((m) => m[1]),
);
if (mounted.size === 0) {
  console.error(`FAIL  platform.module.ts mounts zero controllers. Refusing to pass.`);
  process.exit(1);
}

// ── 2. walk every controller file, keep only mounted classes ──────────────────
const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
  );

const files = walk(V1).filter((f) => f.endsWith(".controller.ts"));
const seen = new Set();
let endpointCount = 0;
const rows = [];

for (const file of files) {
  const src = readFileSync(file, "utf8");
  const rel = file.slice(ROOT.length + 1).replace(/\\/g, "/");

  // Split the file into class bodies so a two-class file attributes decorators
  // to the right class — the exact case that produced the D046 miscount.
  const classMatches = [...src.matchAll(/export class (\w+Controller)\b/g)];
  for (let i = 0; i < classMatches.length; i++) {
    const cls = classMatches[i][1];
    const bodyStart = classMatches[i].index;
    const bodyEnd =
      i + 1 < classMatches.length ? classMatches[i + 1].index : src.length;
    const body = src.slice(bodyStart, bodyEnd);

    if (!mounted.has(cls)) continue;
    seen.add(cls);

    // The @Controller('...') decorator sits immediately ABOVE the class, so search
    // backwards from the class keyword rather than inside the body.
    const preamble = src.slice(0, bodyStart);
    const baseMatch = [...preamble.matchAll(/@Controller\(\s*['"`]([^'"`]*)/g)].pop();
    const base = baseMatch ? baseMatch[1] : "?";

    // Class-level decorators live in the same preamble, after the previous class.
    const prevEnd = i > 0 ? classMatches[i - 1].index : 0;
    const classDecorators = src.slice(prevEnd, bodyStart);
    const classGuards = [...classDecorators.matchAll(/@UseGuards\(([^)]*)\)/g)]
      .map((m) => m[1])
      .join(",");
    const classPerms = /@Permissions\(/.test(classDecorators);

    // Slice the class body into MEMBERS, not into decorator runs.
    //
    // The first version of this gate scoped a route as "from its @Get to the next
    // @Get", which silently assumed decorators come after the HTTP verb. Half this
    // codebase writes them before it:
    //
    //     @Permissions("saas.clusters.read")     @Get("clusters")
    //     @Get("clusters")               versus  @Permissions(...)
    //
    // On the first style every route looked unauthorised, and the gate reported 126
    // violations where 104 were real. A gate that cries wolf gets switched off, so
    // it is worth the extra parsing to be order-independent.
    //
    // A member runs from the previous method signature to this one, which brackets
    // exactly the decorators belonging to it — method BODIES contain no decorators,
    // so nothing leaks across the boundary in either direction.
    const sigRe = /^[ \t]+(?:public\s+|private\s+|protected\s+)?(?:async\s+)?(\w+)\s*\(/gm;
    const sigs = [...body.matchAll(sigRe)].filter((m) => m[1] !== "constructor");

    for (let s = 0; s < sigs.length; s++) {
      const from = s === 0 ? 0 : sigs[s - 1].index;
      const scope = body.slice(from, sigs[s].index);

      const route = /@(Get|Post|Put|Patch|Delete)\(([^)]*)\)/.exec(scope);
      if (!route) continue; // a plain helper method, not an endpoint

      const verb = route[1].toUpperCase();
      const pathArg = /['"`]([^'"`]*)['"`]/.exec(route[2]);
      const path = `/${base}/${pathArg ? pathArg[1] : ""}`.replace(/\/+$/, "") || `/${base}`;

      const hasPerms = classPerms || /@Permissions\(/.test(scope);
      const guardText = classGuards + "," + [...scope.matchAll(/@UseGuards\(([^)]*)\)/g)].map((m) => m[1]).join(",");
      const missingGuards = REQUIRED_GUARDS.filter((g) => !guardText.includes(g));

      endpointCount++;
      const problems = [];
      if (!hasPerms) problems.push("no @Permissions");
      if (missingGuards.length) problems.push(`missing ${missingGuards.join("+")}`);

      rows.push({ verb, path, cls, rel, problems });
      if (problems.length) {
        fail(`${verb.padEnd(6)} ${path.padEnd(52)} ${problems.join("; ")}   (${rel})`);
      }
    }
  }
}

// A controller named in the module but never found on disk means the gate is blind to
// it. Passing in that state is precisely D013 — a gate that is green by being absent.
for (const cls of mounted) {
  if (!seen.has(cls)) {
    fail(`${cls} is mounted in platform.module.ts but no controller file defines it.`);
  }
}

if (LIST) {
  for (const r of rows) {
    console.log(
      `${r.problems.length ? "✗" : "✓"} ${r.verb.padEnd(6)} ${r.path.padEnd(52)} ${r.cls}`,
    );
  }
  console.log("");
}

console.log(
  `check-platform-permissions: ${mounted.size} mounted controllers, ${endpointCount} endpoints.`,
);

if (violations.length) {
  console.error(
    `\n${violations.length} plane-1 endpoint(s) are not authorised.\n\n` +
      `Every /platform/v1 route acts across tenant boundaries. It needs an explicit\n` +
      `@Permissions(...) from the control-plane registry AND a guard chain that enforces\n` +
      `it — see src/platform/v1/tenant-lifecycle.controller.ts, which does this correctly.\n`,
  );
  for (const v of violations) console.error(`FAIL  ${v}`);
  console.error(`\nSee docs/programme/90-DEFECT-LOG.md D046.`);
  process.exit(1);
}

console.log(
  `OK    every mounted /platform/v1 endpoint carries an explicit control-plane ` +
    `permission and a guard chain that enforces it.`,
);
