/**
 * D17 — settings audit and change control. Two mechanisms, both real:
 *
 *   1. A SENSITIVE setting cannot change without an approver:
 *      requestChange() with isSensitive=true creates a PENDING
 *      SettingChangeApproval instead of applying anything; approveChange()
 *      requires a DIFFERENT actor from the requester (the same
 *      two-person-control invariant C04/M49 already established
 *      elsewhere in the platform, applied here to settings) before the
 *      change is applied at all.
 *   2. Every applied change is recorded in the real ChangeHistory table
 *      (D05's own audit trail, reused directly — never a second log) with
 *      actor/before/after/reason, and revertChange() reads the OLD value
 *      straight back out of that record — "revertable to its previous
 *      value from the audit record" made literal, not a separate
 *      undo-stack.
 *
 * Actual settings-VALUE storage is the caller's responsibility (the same
 * boundary D15/D16 already stated) — this service reads/writes
 * ChangeHistory and SettingChangeApproval only; applying the resulting
 * value to wherever settings actually live is done by the caller.
 */
import { Injectable, BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { prisma } from "@kannan19302/database";

export interface RequestChangeResult {
  applied: boolean;
  approvalId?: string;
  changeHistoryId?: string;
}

@Injectable()
export class SettingsChangeControlService {
  /**
   * Requests a change to `key`. A non-sensitive setting applies
   * immediately (writes ChangeHistory, returns applied:true). A
   * sensitive setting NEVER applies here — it creates a PENDING
   * approval and returns applied:false; only approveChange() (by a
   * different actor) can ever apply it.
   */
  async requestChange(
    tenantId: string,
    key: string,
    currentValue: unknown,
    newValue: unknown,
    actorId: string,
    actorName: string,
    reason: string,
    isSensitive: boolean,
  ): Promise<RequestChangeResult> {
    if (isSensitive) {
      const approval = await (prisma as any).settingChangeApproval.create({
        data: { tenantId, key, newValue: newValue as any, requestedBy: actorId, reason, status: "PENDING" },
      });
      return { applied: false, approvalId: approval.id };
    }

    const entry = await this.writeChangeHistory(tenantId, key, currentValue, newValue, actorId, actorName, reason);
    return { applied: true, changeHistoryId: entry.id };
  }

  /**
   * Applies a PENDING sensitive-setting approval. Refuses if the
   * approver is the SAME actor who requested it — a sensitive setting
   * cannot change without a genuinely different approver, enforced
   * here (not merely at a UI layer that could be bypassed by calling
   * this directly).
   */
  async approveChange(tenantId: string, approvalId: string, approverId: string, approverName: string, currentValue: unknown): Promise<RequestChangeResult> {
    const approval = await (prisma as any).settingChangeApproval.findFirst({ where: { id: approvalId, tenantId } });
    if (!approval) throw new NotFoundException(`Approval "${approvalId}" not found`);
    if (approval.status !== "PENDING") throw new BadRequestException(`Approval "${approvalId}" is ${approval.status}, not PENDING`);
    if (approval.requestedBy === approverId) {
      throw new ForbiddenException("A sensitive setting cannot be approved by the same actor who requested the change");
    }

    await (prisma as any).settingChangeApproval.update({
      where: { id: approvalId },
      data: { status: "APPROVED", approvedBy: approverId, decidedAt: new Date() },
    });

    const entry = await this.writeChangeHistory(
      tenantId,
      approval.key,
      currentValue,
      approval.newValue,
      approverId,
      approverName,
      `Approved sensitive setting change (request: ${approval.reason})`,
    );
    return { applied: true, changeHistoryId: entry.id };
  }

  async rejectChange(tenantId: string, approvalId: string, approverId: string) {
    const approval = await (prisma as any).settingChangeApproval.findFirst({ where: { id: approvalId, tenantId } });
    if (!approval) throw new NotFoundException(`Approval "${approvalId}" not found`);
    if (approval.status !== "PENDING") throw new BadRequestException(`Approval "${approvalId}" is ${approval.status}, not PENDING`);
    if (approval.requestedBy === approverId) {
      throw new ForbiddenException("The same actor who requested the change cannot reject their own request either");
    }
    return (prisma as any).settingChangeApproval.update({
      where: { id: approvalId },
      data: { status: "REJECTED", approvedBy: approverId, decidedAt: new Date() },
    });
  }

  /**
   * Reverts a setting to the value it held BEFORE the given
   * ChangeHistory entry — read straight out of the audit record's own
   * `fieldChanges`, never a separate undo log. Recording the revert
   * itself writes a NEW ChangeHistory entry (audit history is
   * append-only; a revert is a new change, not a rewrite of the old
   * one).
   */
  async revertChange(tenantId: string, changeHistoryId: string, actorId: string, actorName: string): Promise<{ revertedToValue: unknown; changeHistoryId: string }> {
    const original = await (prisma as any).changeHistory.findFirst({ where: { id: changeHistoryId, tenantId, entityType: "Setting" } });
    if (!original) throw new NotFoundException(`ChangeHistory entry "${changeHistoryId}" not found for a setting change`);

    const fieldChanges = (original.fieldChanges as Array<{ field: string; from: unknown; to: unknown }>) ?? [];
    const change = fieldChanges.find((f) => f.field === original.entityId);
    if (!change) throw new BadRequestException(`ChangeHistory entry "${changeHistoryId}" has no recorded field change to revert`);

    const entry = await this.writeChangeHistory(
      tenantId,
      original.entityId,
      change.to,
      change.from,
      actorId,
      actorName,
      `Reverted to the value from change ${changeHistoryId}`,
    );
    return { revertedToValue: change.from, changeHistoryId: entry.id };
  }

  private async writeChangeHistory(tenantId: string, key: string, from: unknown, to: unknown, actorId: string, actorName: string, reason: string) {
    return (prisma as any).changeHistory.create({
      data: {
        tenantId,
        userId: actorId,
        userName: actorName,
        entityType: "Setting",
        entityId: key,
        action: "UPDATE",
        fieldChanges: [{ field: key, from, to }],
        metadata: { reason },
      },
    });
  }
}
