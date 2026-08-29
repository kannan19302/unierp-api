#!/usr/bin/env node

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve("src");
const forbidden = /\b(?:prisma\.)?tenantSsoConfig\b/;
const findings = [];

function visit(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      visit(target);
    } else if (entry.isFile() && /\.(?:ts|tsx|js|mjs)$/.test(entry.name)) {
      const lines = readFileSync(target, "utf8").split(/\r?\n/);
      lines.forEach((line, index) => {
        if (forbidden.test(line) && !line.trimStart().startsWith("*")) {
          findings.push(`${path.relative(process.cwd(), target)}:${index + 1}`);
        }
      });
    }
  }
}

visit(root);
if (findings.length > 0) {
  console.error("Retired TenantSsoConfig runtime usage detected:");
  findings.forEach((finding) => console.error(`- ${finding}`));
  process.exit(1);
}

console.log("Retired SSO model gate passed: no active runtime consumer uses TenantSsoConfig.");
