/**
 * Specs in this catalogue exercise the real Prisma client, DDL, RLS, or
 * transaction behaviour. They belong to the integration lane and must not be
 * collected by a database-free unit run.
 *
 * Keep paths workspace-relative and use forward slashes so the catalogue is
 * stable on Windows and Linux runners.
 */
export const DATABASE_BACKED_SPECS = [
  "src/modules/developer/tests/builder-workflow-runtime.service.spec.ts",
  "src/modules/developer/tests/custom-object-schema.service.spec.ts",
  "src/modules/crm/tests/crm-communication-deep.service.spec.ts",
  "src/modules/crm/tests/crm-contract-deep.service.spec.ts",
  "src/modules/documents/tests/documents-advanced.service.spec.ts",
  "src/modules/documents/tests/documents-deep.service.spec.ts",
  "src/modules/documents/tests/drive-deep.service.spec.ts",
  "src/modules/extensions/tests/extension-schema.service.spec.ts",
  "src/modules/marketplace/tests/payout.service.spec.ts",
  "src/modules/marketplace/tests/vendor-signing.spec.ts",
  "src/modules/documents/tests/storage-advanced.service.spec.ts",
  "src/modules/supply-chain/tests/supply-chain-expansion.service.spec.ts",
  "src/modules/workflow/tests/workflow-advanced.service.spec.ts",
] as const;
