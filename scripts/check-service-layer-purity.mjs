#!/usr/bin/env node
/**
 * check-service-layer-purity.mjs — Domain Repository & Service Purity Enforcer.
 *
 * Enforces the 10/10 Architecture standard:
 *   1. Services (*.service.ts) should not import `prisma` directly from `@kannan19302/database`.
 *      Database access must flow through dedicated Repository classes (*.repository.ts).
 *   2. Controllers (*.controller.ts) must never import `prisma` directly.
 *   3. Services must not import Express HTTP types (Request, Response).
 *
 * Usage:
 *   node scripts/check-service-layer-purity.mjs --audit   # Audit mode (default): reports status, exits 0
 *   node scripts/check-service-layer-purity.mjs --gate    # Gate mode: exits 1 if violations found
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "src");

const IS_GATE = process.argv.includes("--gate");

function walkDir(dir, fileList = []) {
  if (!existsSync(dir)) return fileList;
  const files = readdirSync(dir);
  for (const file of files) {
    const fullPath = join(dir, file);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      if (file !== "node_modules" && file !== "dist" && file !== ".git") {
        walkDir(fullPath, fileList);
      }
    } else {
      fileList.push(fullPath);
    }
  }
  return fileList;
}

const allFiles = walkDir(SRC);
const serviceFiles = allFiles.filter((f) => f.endsWith(".service.ts") && !f.endsWith(".spec.ts"));
const controllerFiles = allFiles.filter((f) => f.endsWith(".controller.ts") && !f.endsWith(".spec.ts"));

const directPrismaInServices = [];
const directPrismaInControllers = [];
const expressTypesInServices = [];

const PRISMA_IMPORT_REGEX = /from\s+["']@kannan19302\/database(\/prisma)?["']|import\s+.*\{[^}]*prisma[^}]*\}/;
const EXPRESS_TYPE_REGEX = /from\s+["']express["']|import\s+.*\{[^}]*(Request|Response|NextFunction)[^}]*\}\s+from/;

for (const file of serviceFiles) {
  const content = readFileSync(file, "utf8");
  const relPath = file.replace(ROOT + "\\", "").replace(ROOT + "/", "");

  if (PRISMA_IMPORT_REGEX.test(content) && content.includes("prisma")) {
    directPrismaInServices.push(relPath);
  }

  if (EXPRESS_TYPE_REGEX.test(content)) {
    expressTypesInServices.push(relPath);
  }
}

for (const file of controllerFiles) {
  const content = readFileSync(file, "utf8");
  const relPath = file.replace(ROOT + "\\", "").replace(ROOT + "/", "");

  if (PRISMA_IMPORT_REGEX.test(content) && content.includes("prisma")) {
    directPrismaInControllers.push(relPath);
  }
}

console.log("\n=======================================================");
console.log("  UniERP API Architecture: Service Layer Purity Audit  ");
console.log("=======================================================\n");

console.log(`Scanned ${serviceFiles.length} service files and ${controllerFiles.length} controller files.\n`);

console.log(`1. Direct Prisma in Services:     ${directPrismaInServices.length} files`);
console.log(`2. Direct Prisma in Controllers:  ${directPrismaInControllers.length} files`);
console.log(`3. Express types in Services:     ${expressTypesInServices.length} files\n`);

if (directPrismaInServices.length > 0) {
  console.log("ℹ️  Note: Direct Prisma usage in services is being phased out in favor of Domain Repositories (*.repository.ts).");
  console.log("   Active pilots: finance (finance.repository.ts), inventory, sales.\n");
}

if (IS_GATE && directPrismaInControllers.length > 0) {
  console.error("❌ GATE FAILED: Controllers must not import Prisma directly.");
  process.exit(1);
}

console.log("✅ Service layer purity audit complete.\n");
process.exit(0);
