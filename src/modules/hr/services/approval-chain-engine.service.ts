import { Injectable, ForbiddenException, NotFoundException } from "@nestjs/common";
import { prisma } from "@kannan19302/database";
import { ApprovalRoutingService } from "./approval-routing.service";

export interface ApprovalStepDeclaration {
  level: number;
  /** Resolve the approver by walking the org hierarchy from this position, vacancy-safe (D04). */
  startPositionId?: string;
  /** Or name approvers directly, when no position hierarchy applies. */
  approverUserIds?: string[];
  /** ANY = first approval advances the step (sequential). ALL = every resolved approver must approve (parallel). */
  mode: "ANY" | "ALL";
}

/**
 * E05 — approval-chain engine, usable by any entity by declaration.
 *
 * Built on the generic, entity-agnostic ApprovalProcess/ApprovalRequest/
 * ApprovalAction tables already present in the schema (previously used only
 * by the CRM module's CrmConfigService, via free-text `entity`/`entityType`
 * fields — nothing about them is CRM-specific). This service extracts that
 * capability into a shared engine any module can inject, and fixes two real
 * gaps found while doing so:
 *
 *   1. The pre-existing approveRequest() never verified the acting user was
 *      actually one of the step's approvers — anyone could approve any
 *      pending request. approveStep() here resolves the step's real
 *      approver set first and refuses otherwise.
 *   2. A step declared against an org position had no vacancy handling —
 *      approving a position no one occupies would stall forever. Steps
 *      declared with `startPositionId` are resolved through
 *      ApprovalRoutingService.routeApproval(), D04's own vacancy-escalation
 *      mechanism, reused rather than reimplemented.
 */
@Injectable()
export class ApprovalChainEngineService {
  constructor(private readonly routing: ApprovalRoutingService) {}

  async declareApproval(
    tenantId: string,
    orgId: string,
    name: string,
    entity: string,
    steps: ApprovalStepDeclaration[],
    createdBy: string,
  ) {
    return prisma.approvalProcess.create({
      data: {
        tenantId,
        orgId,
        name,
        entity,
        steps: steps as any,
        createdBy,
      },
    });
  }

  /**
   * Resolves a step's real approver set: named users as-is, or a position's
   * occupant found by climbing the hierarchy past any vacancy. Throws
   * (never silently returns an empty set) when a position-based step
   * exhausts the hierarchy with no occupant found — the exit criterion's
   * own words, "escalates rather than stalling," and stalling on a request
   * no one can ever approve is exactly what a silent empty set would do.
   */
  private async resolveStepApprovers(tenantId: string, requestId: string, step: ApprovalStepDeclaration): Promise<string[]> {
    if (step.approverUserIds && step.approverUserIds.length > 0) {
      return step.approverUserIds;
    }
    if (step.startPositionId) {
      const routed = await this.routing.routeApproval(tenantId, requestId, step.startPositionId);
      return [routed.finalApproverUserId as string];
    }
    throw new NotFoundException(`Step ${step.level} declares neither startPositionId nor approverUserIds — cannot resolve an approver.`);
  }

  async submitForApproval(tenantId: string, userId: string, entityType: string, entityId: string, processId?: string) {
    const process = processId
      ? await prisma.approvalProcess.findFirst({ where: { id: processId, tenantId, isActive: true } })
      : await prisma.approvalProcess.findFirst({ where: { tenantId, entity: entityType, isActive: true } });
    if (!process) throw new NotFoundException("No matching approval process found");

    const steps = process.steps as unknown as ApprovalStepDeclaration[];
    if (steps.length === 0) throw new NotFoundException("Approval process declares zero steps");

    const request = await prisma.approvalRequest.create({
      data: {
        tenantId,
        processId: process.id,
        entityType,
        entityId,
        submittedBy: userId,
        status: "PENDING",
        currentStep: 0,
      },
    });

    // Resolve step 0's real approvers immediately, so a request is never
    // created "pending" against a vacant position with no one who could
    // ever act on it.
    const firstStep = steps[0];
    if (!firstStep) throw new NotFoundException("Approval process declares zero steps");
    const currentApprovers = await this.resolveStepApprovers(tenantId, request.id, firstStep);
    return prisma.approvalRequest.update({
      where: { id: request.id },
      data: { metadata: { currentApprovers } as any },
    });
  }

  async approveStep(tenantId: string, requestId: string, userId: string, comments?: string) {
    const request = await prisma.approvalRequest.findFirst({ where: { id: requestId, tenantId, status: "PENDING" } });
    if (!request) throw new NotFoundException("Approval request not found or not pending");

    const process = await prisma.approvalProcess.findFirst({ where: { id: request.processId } });
    if (!process) throw new NotFoundException("Approval process not found");

    const steps = process.steps as unknown as ApprovalStepDeclaration[];
    const step = steps[request.currentStep];
    if (!step) throw new NotFoundException(`Request references step ${request.currentStep}, which the process no longer declares`);
    const currentApprovers = ((request.metadata as any)?.currentApprovers || []) as string[];

    if (!currentApprovers.includes(userId)) {
      throw new ForbiddenException(
        `User "${userId}" is not an authorized approver for step ${step.level} of this request.`,
      );
    }

    await prisma.approvalAction.create({
      data: { tenantId, requestId, step: request.currentStep, userId, action: "APPROVED", comments: comments || null },
    });

    if (step.mode === "ALL") {
      const actionsThisStep = await prisma.approvalAction.findMany({ where: { requestId, step: request.currentStep } });
      const approvedBy = new Set(actionsThisStep.filter((a: any) => a.action === "APPROVED").map((a: any) => a.userId));
      const stillWaiting = currentApprovers.some((a) => !approvedBy.has(a));
      if (stillWaiting) {
        return request; // still PENDING — not every parallel approver has acted yet
      }
    }

    const nextStepIndex = request.currentStep + 1;
    if (nextStepIndex >= steps.length) {
      return prisma.approvalRequest.update({
        where: { id: requestId },
        data: { status: "APPROVED", currentStep: nextStepIndex, completedAt: new Date() },
      });
    }

    const nextStep = steps[nextStepIndex];
    if (!nextStep) throw new NotFoundException(`Process declares no step at index ${nextStepIndex}`);
    const nextApprovers = await this.resolveStepApprovers(tenantId, requestId, nextStep);
    return prisma.approvalRequest.update({
      where: { id: requestId },
      data: { currentStep: nextStepIndex, metadata: { currentApprovers: nextApprovers } as any },
    });
  }
}
