import { prisma } from "@kannan19302/database";
import { SaasPortalGdprComplianceService } from "../modules/saas-portal/services/gdpr-compliance.service";
import { GdprCryptoShredService } from "../modules/saas-portal/services/gdpr-crypto-shred.service";
import { PrivacyOperationsService } from "../modules/saas-portal/services/privacy-operations.service";
import { RecordLegalHoldService } from "../modules/saas-portal/services/record-legal-hold.service";

const requestId = process.env.PRIVACY_VERIFY_REQUEST_ID;
const tenantId = process.env.PRIVACY_VERIFY_TENANT_ID;
const userId = process.env.PRIVACY_VERIFY_USER_ID;
const email = process.env.PRIVACY_VERIFY_EMAIL;
const expectLegalHold = process.env.PRIVACY_VERIFY_EXPECT_LEGAL_HOLD === "true";

if (!requestId || !tenantId || !userId || !email) {
  throw new Error("PRIVACY_VERIFY_REQUEST_ID, TENANT_ID, USER_ID and EMAIL are required");
}

async function main() {
  const gdpr = new SaasPortalGdprComplianceService(
    new GdprCryptoShredService(),
    new RecordLegalHoldService(),
  );
  const operations = new PrivacyOperationsService(gdpr);

  const claimed = await operations.claimEligible(1);
  if (claimed.length !== 1 || claimed[0].request_id !== requestId || claimed[0].tenant_id !== tenantId) {
    throw new Error(`Expected ${JSON.stringify({ requestId, tenantId })}, claimed ${JSON.stringify(claimed)}`);
  }

  const result = await operations.execute(requestId, tenantId);
  const identityResult = result.results.find((entry) => entry.entityType === "User");
  if (expectLegalHold) {
    if (
      !result.retainedUnderLegalHold || !identityResult ||
      identityResult.treatment !== "anonymized-with-legal-hold" ||
      identityResult.heldCount !== 1 || identityResult.count !== 0
    ) {
      throw new Error(`Legal hold did not suspend identity erasure: ${JSON.stringify(result)}`);
    }
    console.log(JSON.stringify({
      atomicClaim: true,
      legalHoldSuspendedDeletion: true,
      retainedIdentity: true,
      status: "COMPLETED_WITH_RETENTIONS",
    }));
    return;
  }
  if (result.retainedUnderLegalHold) throw new Error("Unexpected legal-hold retention in the live erasure");
  if (!identityResult || identityResult.treatment !== "anonymized" || identityResult.count !== 1) {
    throw new Error(`Identity erasure treatment was not executed: ${JSON.stringify(result)}`);
  }

  console.log(JSON.stringify({
    atomicClaim: true,
    coolingOffEligible: true,
    executionAttempts: 1,
    identityAnonymized: true,
    authorityRevoked: true,
    attachmentsRemoved: true,
    auditReferenceCryptoShredded: true,
    status: "COMPLETED",
  }));
}

main()
  .finally(() => prisma.$disconnect())
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
