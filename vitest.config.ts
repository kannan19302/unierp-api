import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // tsconfig.json declares `"@/*": ["./src/*"]`, but vitest does not read
  // tsconfig paths — so every spec that imported through the `@/` alias failed
  // at collection with "Failed to load url @/common/idp-client", reporting zero
  // tests rather than a failure. Mirroring the alias here is what makes those
  // suites run at all; it must stay in step with tsconfig.
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // Resolve the sibling workspace packages from disk rather than from the
      // registry copy in node_modules.
      //
      // `@kannan19302/shared` 1.0.5 is published, but the local source at the
      // SAME version number is ahead of it: `policy/engine` (CONTROL_PLANE_ROLE,
      // CONTROL_PLANE_ROLE_PERMISSIONS) exists on disk and not in the published
      // dist. policy-engine.spec.ts and permission-harness-coverage.spec.ts
      // therefore imported `undefined` and failed with "Cannot read properties
      // of undefined", which reads as a broken guard and is actually a stale
      // package. Tests should exercise the source in this checkout.
      //
      // Test-time only: the Docker build context is this repo alone, so runtime
      // resolution is untouched and still uses the published package.
      "@kannan19302/shared": fileURLToPath(
        new URL("../shared/dist/index.js", import.meta.url),
      ),
      // `@kannan19302/database` is a DANGLING symlink in node_modules: it points
      // at ../unierp-data, a directory that does not exist (the package lives in
      // ../data). Anything importing it failed to collect with "Failed to load
      // url @kannan19302/database". ../data is the same version the manifest
      // asks for (1.0.14) and carries a built dist.
      "@kannan19302/database": fileURLToPath(
        new URL("../data/dist/index.js", import.meta.url),
      ),
    },
  },
  test: {
    // Part of the suite is written Jest-style and relies on `describe`/`it`/
    // `expect` being global rather than imported from 'vitest'. Without this
    // those files fail at collection with "describe is not defined", which
    // looks like a broken test but is purely a config gap. Enabling globals
    // changes no test's meaning; files that import from 'vitest' explicitly
    // keep working unchanged.
    globals: true,
    // Exposes `vi` as `jest` for the Jest-era files. See the file for the
    // hoisting caveat around jest.mock.
    setupFiles: ["./test/jest-compat.setup.ts"],
    env: {
      NEXTAUTH_SECRET: "test_secret_for_vitest_unit_runs",
      // Prisma sizes its connection pool at (cores * 2 + 1) per client. On a
      // 16-core host that is 33 connections, and the fork pool below runs up to
      // 4 workers, so the suite asked Postgres for ~132 connections against a
      // default max_connections of 100. The overflow surfaced as
      // "PrismaClientInitializationError: Can't reach database server" on a
      // different handful of specs every run — which reads like flakiness in the
      // tests and is actually the runner exhausting the server. Bounding the
      // per-worker pool keeps the whole suite under ~20 connections regardless
      // of how many cores the host or CI runner has.
      ...(process.env.DATABASE_URL &&
      !process.env.DATABASE_URL.includes("connection_limit")
        ? {
            DATABASE_URL: `${process.env.DATABASE_URL}${
              process.env.DATABASE_URL.includes("?") ? "&" : "?"
            }connection_limit=5&pool_timeout=20`,
          }
        : {}),
    },
    testTimeout: 10000,
    hookTimeout: 10000,
    // Memory-isolated forks. The generated Prisma client (362 models) plus the
    // large service graph make module transform/collection memory-heavy, so we
    // spread files across several forks (each accumulates less) and cap per-fork
    // heap so the total stays well under host RAM. Previously a single 8 GB
    // heap per fork × maxForks exhausted a 16 GB host and killed workers
    // ("Worker exited unexpectedly"), which the run-tests-sequential.ps1 hack
    // worked around one-file-per-process. This runs the full suite in parallel.
    pool: "forks",
    poolOptions: {
      forks: {
        execArgv: ["--max-old-space-size=2048"],
        minForks: 1,
        // 2 locally as well as in CI. This machine also runs a Kubernetes
        // cluster and the package registry through the same Docker Desktop
        // networking stack, and at 4 forks the failure was connection
        // ESTABLISHMENT timing out — "Can't reach database server" after ~5s —
        // rather than pool exhaustion: Postgres itself sat idle at 6
        // connections and 0% CPU while specs failed. Fewer concurrent
        // connection attempts is the fix; raising max_connections was not,
        // because the ceiling was never what was being hit.
        maxForks: 2,
      },
    },
    // L13 — this list must be identical whether process.env.CI is set or
    // not: CI previously excluded *.coverage.spec.ts (the D016/L11/L12
    // always-passing padding files), which meant a test that only ever
    // ran locally could rot for months with nobody noticing, since CI
    // never executed it at all. The whole suite runs everywhere it runs.
    // `.stryker-tmp/sandbox-*` holds full source copies left behind by
    // interrupted Stryker mutation runs. Vitest globbed them, so the suite
    // collected every spec ~11 times over and reported hundreds of phantom
    // failures from stale copies (836 tests instead of 138). They are build
    // artefacts, never a test target.
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.stryker-tmp/**",
    ],
    coverage: {
      provider: "v8",
      // `json` emits coverage/coverage-final.json for tooling that consumes
      // machine-readable coverage.
      reporter: ["text", "json", "html"],
      reportsDirectory: "./coverage",
      all: true,
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
      exclude: [
        "src/**/*.spec.ts",
        "src/**/tests/**",
        "src/**/dto/**",
        "src/main.ts",
        "src/tracing.ts",
        "src/**/*.module.ts",
      ],
    },
  },
});
