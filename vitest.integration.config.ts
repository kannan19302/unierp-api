import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { DATABASE_BACKED_SPECS } from "./test/database-backed-specs";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@kannan19302/shared": fileURLToPath(
        new URL("../shared/dist/index.js", import.meta.url),
      ),
      "@kannan19302/database": fileURLToPath(
        new URL("../data/dist/index.js", import.meta.url),
      ),
    },
  },
  test: {
    include: ["**/*.itest.ts", ...DATABASE_BACKED_SPECS],
    // Stryker retains mutated test copies under this generated directory.
    // They are not part of the integration suite and otherwise make each
    // database test run once per stale mutation sandbox.
    exclude: ["**/.stryker-tmp/**", "**/node_modules/**"],
    env: {
      NEXTAUTH_SECRET: "itest_secret",
      DATABASE_URL:
        "postgresql://unerp:unerp_password@localhost:5432/unerp_test?schema=public",
    },
    globals: true,
    setupFiles: ["./test/jest-compat.setup.ts"],
    testTimeout: 30000,
    hookTimeout: 30000,
    pool: "forks",
  },
});
