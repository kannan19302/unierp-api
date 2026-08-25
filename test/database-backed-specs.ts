/**
 * Specs in this catalogue exercise the real Prisma client, DDL, RLS, or
 * transaction behaviour. They belong to the integration lane and must not be
 * collected by a database-free unit run.
 *
 * Keep paths workspace-relative and use forward slashes so the catalogue is
 * stable on Windows and Linux runners.
 */
export const DATABASE_BACKED_SPECS = [
  "src/developer/builder/tests/builder-workflow-runtime.service.spec.ts",
  "src/developer/builder/tests/custom-object-schema.service.spec.ts",
  "src/modules/crm/crm-communication-deep.service.spec.ts",
  "src/modules/crm/crm-contract-deep.service.spec.ts",
  "src/modules/documents/tests/documents-advanced.service.spec.ts",
  "src/modules/documents/tests/documents-deep.service.spec.ts",
  "src/modules/drive/tests/drive-deep.service.spec.ts",
  "src/modules/extension-registry/tests/extension-schema.service.spec.ts",
  "src/modules/marketplace/tests/payout.service.spec.ts",
  "src/modules/marketplace/tests/vendor-signing.spec.ts",
  "src/modules/storage/tests/storage-advanced.service.spec.ts",
  "src/modules/supply-chain/tests/supply-chain-expansion.service.spec.ts",
  "src/modules/workflow/tests/workflow-advanced.service.spec.ts",
] as const;
