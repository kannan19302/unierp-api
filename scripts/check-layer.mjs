#!/usr/bin/env node
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const apiRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const gate = resolve(apiRoot, "..", "unierp-workspace", "scripts", "check-layer.mjs");
if (!existsSync(gate)) {
  console.error(`Active-estate layer gate is unavailable at ${gate}. Check out unierp-workspace beside api.`);
  process.exit(1);
}
const result = spawnSync(process.execPath, [gate, "--repo-root", apiRoot], { stdio: "inherit" });
process.exit(result.status ?? 1);
