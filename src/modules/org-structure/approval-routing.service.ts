/**
 * D04 — approval routing over the reporting hierarchy (OrgPosition's
 * manager chain). A vacant position is handled by ESCALATION: routing
 * climbs to the next manager rather than stopping, so "no one at this
 * level" never means "the approval silently has no approver." Escalation
 * only stops climbing once an occupied position is found (the approver)
 * or the level ceiling is reached (a refusal, never a silent success).
 */
import { Injectable, BadRequestException } from "@nestjs/common";
import { prisma } from "@kannan19302/database";

export interface ApprovalChainEntry {
  positionId: string;
  level: number;
  userId: string | null;
  escalated: boolean;
}

@Injectable()
export class ApprovalRoutingService {
  /**
   * Walks up to `maxLevels` positions starting at `startPositionId`. Each
   * vacant position is recorded as `escalated: true` and routing
   * continues to its manager; the first OCCUPIED position found becomes
   * the final approver. Exhausting `maxLevels` without finding an
   * occupant refuses loudly rather than routing to nobody.
   */
  async routeApproval(tenantId: string, requestId: string, startPositionId: string, maxLevels: number = 3) {
    const chain: ApprovalChainEntry[] = [];
    let currentPositionId: string | null = startPositionId;

    for (let level = 1; level <= maxLevels && currentPositionId; level++) {
      const position = await (prisma as any).orgPosition.findUnique({ where: { id: currentPositionId } });
      if (!position || position.tenantId !== tenantId) {
        throw new BadRequestException(`Position "${currentPositionId}" not found in tenant "${tenantId}"`);
      }

      if (position.occupantUserId) {
        chain.push({ positionId: position.id, level, userId: position.occupantUserId, escalated: level > 1 });
        return (prisma as any).approvalRouting.create({
          data: { tenantId, requestId, startPositionId, approverChain: chain, finalApproverUserId: position.occupantUserId },
        });
      }

      chain.push({ positionId: position.id, level, userId: null, escalated: true });
      currentPositionId = position.managerPositionId;
    }

    throw new BadRequestException(
      `No occupied position found within ${maxLevels} level(s) of "${startPositionId}" — every position in the chain is vacant`,
    );
  }
}
