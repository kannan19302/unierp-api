import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["**/*.itest.ts"],
    // Stryker retains mutated test copies under this generated directory.
    // They are not part of the integration suite and otherwise make each
    // database test run once per stale mutation sandbox.
    exclude: ["**/.stryker-tmp/**", "**/node_modules/**"],
    env: {
      NEXTAUTH_SECRET: "itest_secret",
      DATABASE_URL:
        "postgresql://unerp:unerp_password@localhost:5432/unerp_test?schema=public",
    },
    testTimeout: 30000,
    hookTimeout: 30000,
    pool: "forks",
  },
});
