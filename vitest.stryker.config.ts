import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      crypto: "node:crypto",
    },
  },
  optimizeDeps: {
    include: ["node:crypto"],
  },
  test: {
    globals: true,
    setupFiles: ["./test/jest-compat.setup.ts"],
    env: {
      NEXTAUTH_SECRET: "test_secret_for_vitest_unit_runs",
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
    pool: "forks",
    poolOptions: {
      forks: {
        execArgv: ["--max-old-space-size=4096"],
        minForks: 1,
        maxForks: 1,
      },
    },
    exclude: ["**/node_modules/**", "**/dist/**"],
    coverage: {
      provider: "v8",
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