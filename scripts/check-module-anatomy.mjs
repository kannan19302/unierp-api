import fs from "node:fs";
import path from "node:path";

const rootModulesDir = path.resolve("src/modules");

console.log("=======================================================");
console.log("  UniERP API Architecture: Module Anatomy Audit (10/10)");
console.log("=======================================================\n");

const modules = fs.readdirSync(rootModulesDir, { withFileTypes: true })
  .filter(d => d.isDirectory())
  .map(d => d.name);

console.log(`Auditing ${modules.length} canonical domain modules...\n`);

let violations = 0;

for (const mod of modules) {
  const modDir = path.join(rootModulesDir, mod);
  const items = fs.readdirSync(modDir, { withFileTypes: true });

  const subDirs = items.filter(i => i.isDirectory()).map(i => i.name);
  const rootFiles = items.filter(i => !i.isDirectory()).map(i => i.name);

  // Check required subdirectories
  const hasControllers = subDirs.includes("controllers");
  const hasServices = subDirs.includes("services");
  const hasRepositories = subDirs.includes("repositories");

  if (!hasControllers || !hasServices || !hasRepositories) {
    console.error(`❌ [${mod}] Missing required layer directories (controllers: ${hasControllers}, services: ${hasServices}, repositories: ${hasRepositories})`);
    violations++;
  }

  // Check that no misplaced source files exist in root
  for (const file of rootFiles) {
    if (file.endsWith(".controller.ts") || file.endsWith(".service.ts") || file.endsWith(".repository.ts") || file.endsWith(".spec.ts")) {
      console.error(`❌ [${mod}] Loose file in module root (should be in dedicated layer subdirectory): ${file}`);
      violations++;
    }
  }
}

if (violations > 0) {
  console.error(`\n❌ Found ${violations} module anatomy violations.`);
  process.exit(1);
} else {
  console.log(`✅ All ${modules.length} domain modules strictly adhere to the 10/10 Canonical Uniform Anatomy.`);
}
