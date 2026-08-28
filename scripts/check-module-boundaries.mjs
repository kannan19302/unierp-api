#!/usr/bin/env node
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const apiRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workspaceGate = resolve(apiRoot, "..", "unierp-workspace", "scripts", "check-module-boundaries.mjs");

if (!existsSync(workspaceGate)) {
  console.error(`Module boundary gate is unavailable at ${workspaceGate}. Check out the active unierp-workspace repository beside api.`);
  process.exit(1);
}

const result = spawnSync(process.execPath, [workspaceGate, "--api-root", resolve(apiRoot, "src")], {
  stdio: "inherit",
});
process.exit(result.status ?? 1);
