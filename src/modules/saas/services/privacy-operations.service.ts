import { Injectable } from "@nestjs/common";
import { prisma } from "@kannan19302/database";
import { SaasPortalGdprComplianceService } from "./gdpr-compliance.service";

type ClaimedErasure = { request_id: string; tenant_id: string };
type PurgedExport = { job_id: string; tenant_id: string; file_url: string | null };

/**
 * Cross-tenant privacy orchestration is deliberately limited to two
 * SECURITY DEFINER database functions. They atomically claim due work under
 * RLS and expose identifiers only; all subject processing re-enters the
 * ordinary tenant-scoped clients in SaasPortalGdprComplianceService.
 */
@Injectable()
export class PrivacyOperationsService {
  constructor(private readonly gdpr: SaasPortalGdprComplianceService) {}

  async claimEligible(limit = 25): Promise<ClaimedErasure[]> {
    const bounded = Math.min(Math.max(Math.trunc(limit), 1), 100);
    return prisma.$queryRaw<ClaimedErasure[]>`
      SELECT * FROM privacy_claim_eligible_erasure_requests(CAST(${bounded} AS INTEGER))
    `;
  }

  async execute(requestId: string, tenantId: string) {
    return this.gdpr.executeErasure(tenantId, requestId);
  }

  async purgeExpiredExports(limit = 100): Promise<PurgedExport[]> {
    const bounded = Math.min(Math.max(Math.trunc(limit), 1), 500);
    return prisma.$queryRaw<PurgedExport[]>`
      SELECT * FROM privacy_purge_expired_export_jobs(CAST(${bounded} AS INTEGER))
    `;
  }
}
