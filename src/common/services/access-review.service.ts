import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { prisma } from "@kannan19302/database";
import { idpClient as idpPrisma } from "../idp-client";
import { parseRolePermissions } from "@kannan19302/shared";

export type AccessReviewScope = "ORGANIZATION" | "PROVIDER";
export type AccessReviewDecision = "CERTIFIED" | "REVOKE" | "EXCEPTION";

@Injectable()
export class AccessReviewService {
  /**
   * idpClient's transaction delegate is intentionally the raw Prisma
   * transaction client. Re-establish the PostgreSQL tenant setting inside the
   * transaction so IDP RLS remains enforced for multi-statement mutations.
   */
  private async inIdpTransaction<T>(tenantId: string, operation: (tx: any) => Promise<T>): Promise<T> {
    return idpPrisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        SELECT set_config('app.current_tenant_id', ${tenantId}, true)
      `;
      return operation(tx);
    });
  }

  async listCampaigns(tenantId: string, scope: AccessReviewScope) {
    return idpPrisma.accessReviewCampaign.findMany({
      where: { tenantId, scope },
      include: { _count: { select: { items: true } } },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    });
  }

  async getCampaign(tenantId: string, scope: AccessReviewScope, campaignId: string) {
    const campaign = await idpPrisma.accessReviewCampaign.findFirst({
      where: { id: campaignId, tenantId, scope },
      include: {
        items: {
          include: { decisions: { orderBy: { createdAt: "asc" } } },
          orderBy: [{ principalId: "asc" }, { grantFingerprint: "asc" }],
        },
      },
    });
    if (!campaign) throw new NotFoundException("Access review campaign not found");
    return campaign;
  }

  async createCampaign(
    tenantId: string,
    scope: AccessReviewScope,
    actorId: string,
    input: { name: string; description?: string; dueAt?: string; reviewerStrategy?: Record<string, unknown> },
  ) {
    const dueAt = input.dueAt ? new Date(input.dueAt) : null;
    if (dueAt && Number.isNaN(dueAt.getTime())) {
      throw new BadRequestException("dueAt must be an ISO-8601 date-time");
    }
    return idpPrisma.accessReviewCampaign.create({
      data: {
        tenantId,
        scope,
        name: input.name.trim(),
        description: input.description?.trim() || null,
        dueAt,
        reviewerStrategy: (input.reviewerStrategy ?? {}) as never,
        createdBy: actorId,
      },
    });
  }

  /**
   * Captures current direct-role and attached-package grants once, at launch.
   * The snapshot is immutable evidence; later role changes do not rewrite what
   * reviewers were asked to certify.
   */
  async launchCampaign(
    tenantId: string,
    scope: AccessReviewScope,
    campaignId: string,
  ) {
    const campaign = await idpPrisma.accessReviewCampaign.findFirst({
      where: { id: campaignId, tenantId, scope },
    });
    if (!campaign) throw new NotFoundException("Access review campaign not found");
    if (campaign.status !== "DRAFT") {
      throw new BadRequestException("Only a draft access review can be launched");
    }

    const grants = await idpPrisma.userRole.findMany({
      where: {
        user: { tenantId, deletedAt: null },
        role: { tenantId },
      },
      include: { user: true, role: true },
    });
    const roleIds = Array.from(new Set(grants.map((grant) => grant.roleId)));
    const packageAssignments = roleIds.length
      ? await prisma.roleAccessPackage.findMany({
          where: {
            roleId: { in: roleIds },
            accessPackage: { tenantId },
          },
          include: { accessPackage: true },
        })
      : [];

    const itemData = grants.flatMap((grant) => {
      const roleSnapshot = {
        kind: "ROLE",
        principal: { id: grant.user.id, email: grant.user.email },
        role: {
          id: grant.role.id,
          name: grant.role.name,
          permissions: parseRolePermissions(grant.role.permissions),
        },
      };
      const direct = {
        tenantId,
        campaignId,
        principalId: grant.userId,
        roleId: grant.roleId,
        grantFingerprint: `role:${grant.userId}:${grant.roleId}`,
        snapshot: roleSnapshot,
      };
      const packages = packageAssignments
        .filter((assignment) => assignment.roleId === grant.roleId)
        .map((assignment) => ({
          tenantId,
          campaignId,
          principalId: grant.userId,
          roleId: grant.roleId,
          accessPackageId: assignment.accessPackageId,
          grantFingerprint: `package:${grant.userId}:${grant.roleId}:${assignment.accessPackageId}`,
          snapshot: {
            kind: "ACCESS_PACKAGE",
            principal: { id: grant.user.id, email: grant.user.email },
            role: { id: grant.role.id, name: grant.role.name },
            accessPackage: {
              id: assignment.accessPackage.id,
              name: assignment.accessPackage.name,
              permissions: parseRolePermissions(assignment.accessPackage.permissions),
            },
          },
        }));
      return [direct, ...packages];
    });

    await this.inIdpTransaction(tenantId, async (tx) => {
      if (itemData.length > 0) {
        await tx.accessReviewItem.createMany({ data: itemData, skipDuplicates: true });
      }
      const transitioned = await tx.accessReviewCampaign.updateMany({
        where: { id: campaignId, tenantId, scope, status: "DRAFT" },
        data: { status: "ACTIVE", launchedAt: new Date(), startsAt: campaign.startsAt ?? new Date() },
      });
      if (transitioned.count !== 1) {
        throw new BadRequestException("Only a draft access review can be launched");
      }
    });

    return this.getCampaign(tenantId, scope, campaignId);
  }

  async decideItem(
    tenantId: string,
    scope: AccessReviewScope,
    campaignId: string,
    itemId: string,
    actorId: string,
    decision: AccessReviewDecision,
    reason?: string,
  ) {
    const item = await idpPrisma.accessReviewItem.findFirst({
      where: { id: itemId, campaignId, tenantId, campaign: { scope, status: "ACTIVE" } },
    });
    if (!item) throw new NotFoundException("Active access review item not found");
    if (item.decision !== "PENDING") {
      throw new BadRequestException("Access review item has already been decided");
    }
    if (decision === "EXCEPTION" && !reason?.trim()) {
      throw new BadRequestException("An exception decision requires a reason");
    }

    const decidedAt = new Date();
    await this.inIdpTransaction(tenantId, async (tx) => {
      const updated = await tx.accessReviewItem.updateMany({
        where: { id: itemId, campaignId, tenantId, decision: "PENDING" },
        data: {
          decision,
          decisionReason: reason?.trim() || null,
          decidedAt,
          remediationStatus: decision === "REVOKE" ? "PENDING" : "NOT_REQUIRED",
        },
      });
      if (updated.count !== 1) {
        throw new BadRequestException("Access review item has already been decided");
      }
      await tx.accessReviewDecisionHistory.create({
        data: { tenantId, itemId, actorId, decision, reason: reason?.trim() || null },
      });
    });
    return this.getCampaign(tenantId, scope, campaignId);
  }

  async completeCampaign(tenantId: string, scope: AccessReviewScope, campaignId: string) {
    const campaign = await this.getCampaign(tenantId, scope, campaignId);
    if (campaign.status !== "ACTIVE") {
      throw new BadRequestException("Only an active access review can be completed");
    }
    const unresolved = campaign.items.filter(
      (item) => item.decision === "PENDING" || item.remediationStatus === "PENDING",
    );
    if (unresolved.length > 0) {
      throw new BadRequestException(
        `Cannot complete access review: ${unresolved.length} item(s) still need a decision or remediation`,
      );
    }
    await idpPrisma.accessReviewCampaign.update({
      where: { id: campaignId },
      data: { status: "COMPLETED", completedAt: new Date() },
    });
    return this.getCampaign(tenantId, scope, campaignId);
  }
}
