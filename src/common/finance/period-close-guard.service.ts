import { Injectable, BadRequestException } from "@nestjs/common";
import { prisma } from "@kannan19302/database";

/**
 * E06 — makes "closing a period makes its documents immutable" a real,
 * enforced mechanism rather than a status flag with no consumer.
 * CloseOpsService.closeFinancialPeriod() previously only flipped
 * FinancialPeriod.status, and no other service ever read that status —
 * GlAccountingService.postJournal()/reverseJournal() would happily mutate
 * the ledger for a date inside a "closed" period. This guard is the missing
 * enforcement point; callers must invoke assertPeriodOpen() before any
 * write dated within a period, and refuse to proceed if it throws.
 */
@Injectable()
export class PeriodCloseGuardService {
  /**
   * Refuses (BadRequestException, naming the period) if `date` falls
   * inside a CLOSED FinancialPeriod for this tenant/org. A date with no
   * matching period record is allowed — there is nothing declared to
   * enforce, which is different from "was checked and found open."
   */
  async assertPeriodOpen(tenantId: string, orgId: string, date: Date): Promise<void> {
    const period = await prisma.financialPeriod.findFirst({
      where: {
        tenantId,
        orgId,
        startDate: { lte: date },
        endDate: { gte: date },
      },
    });
    if (period && period.status === "CLOSED") {
      throw new BadRequestException(
        `Period "${period.name}" (${period.id}) is CLOSED. A posted document is never mutated within a closed ` +
          `period — reverse it in an open period instead, or reopen "${period.name}" first (requires an approver).`,
      );
    }
  }
}
