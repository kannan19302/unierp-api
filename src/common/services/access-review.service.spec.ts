import { BadRequestException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  prisma: { roleAccessPackage: { findMany: vi.fn() } },
  idpPrisma: {
    accessReviewCampaign: {
      findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn(),
    },
    accessReviewItem: { findFirst: vi.fn(), createMany: vi.fn(), updateMany: vi.fn() },
    accessReviewDecisionHistory: { create: vi.fn() },
    userRole: { findMany: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("@kannan19302/database", () => db);

import { AccessReviewService } from "./access-review.service";

const campaign = {
  id: "review-1", tenantId: "tenant-a", scope: "ORGANIZATION", status: "DRAFT", startsAt: null,
};

describe("AccessReviewService", () => {
  let service: AccessReviewService;
  const tx = {
    $executeRaw: vi.fn(),
    accessReviewCampaign: { updateMany: vi.fn() },
    accessReviewItem: { createMany: vi.fn(), updateMany: vi.fn() },
    accessReviewDecisionHistory: { create: vi.fn() },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    db.idpPrisma.$transaction.mockImplementation((operation: (client: typeof tx) => unknown) => operation(tx));
    tx.$executeRaw.mockResolvedValue(1);
    tx.accessReviewCampaign.updateMany.mockResolvedValue({ count: 1 });
    tx.accessReviewItem.createMany.mockResolvedValue({ count: 1 });
    tx.accessReviewItem.updateMany.mockResolvedValue({ count: 1 });
    tx.accessReviewDecisionHistory.create.mockResolvedValue({ id: "history-1" });
    service = new AccessReviewService();
  });

  it("snapshots role and package grants, then establishes the IDP RLS tenant in its transaction", async () => {
    db.idpPrisma.accessReviewCampaign.findFirst
      .mockResolvedValueOnce(campaign)
      .mockResolvedValueOnce({ ...campaign, status: "ACTIVE", items: [] });
    db.idpPrisma.userRole.findMany.mockResolvedValue([
      { userId: "user-1", roleId: "role-1", user: { id: "user-1", email: "a@example.com" }, role: { id: "role-1", name: "Admin", permissions: '["occ.access-governance.access"]' } },
    ]);
    db.prisma.roleAccessPackage.findMany.mockResolvedValue([
      { roleId: "role-1", accessPackageId: "package-1", accessPackage: { id: "package-1", name: "Approver", permissions: '["finance.approve"]' } },
    ]);

    await service.launchCampaign("tenant-a", "ORGANIZATION", "review-1");

    expect(tx.$executeRaw).toHaveBeenCalledOnce();
    expect(tx.accessReviewItem.createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.arrayContaining([
        expect.objectContaining({ grantFingerprint: "role:user-1:role-1" }),
        expect.objectContaining({ grantFingerprint: "package:user-1:role-1:package-1" }),
      ]),
      skipDuplicates: true,
    }));
    expect(tx.accessReviewCampaign.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "review-1", tenantId: "tenant-a", scope: "ORGANIZATION", status: "DRAFT" },
    }));
  });

  it("records a revoke decision and leaves remediation pending", async () => {
    db.idpPrisma.accessReviewItem.findFirst.mockResolvedValue({ id: "item-1", decision: "PENDING" });
    db.idpPrisma.accessReviewCampaign.findFirst.mockResolvedValue({ ...campaign, status: "ACTIVE", items: [] });

    await service.decideItem("tenant-a", "ORGANIZATION", "review-1", "item-1", "reviewer-1", "REVOKE", "Role no longer needed");

    expect(tx.accessReviewItem.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "item-1", campaignId: "review-1", tenantId: "tenant-a", decision: "PENDING" },
      data: expect.objectContaining({ decision: "REVOKE", remediationStatus: "PENDING" }),
    }));
    expect(tx.accessReviewDecisionHistory.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ tenantId: "tenant-a", itemId: "item-1", actorId: "reviewer-1", decision: "REVOKE" }),
    });
  });

  it("requires a reason for an exception decision", async () => {
    db.idpPrisma.accessReviewItem.findFirst.mockResolvedValue({ id: "item-1", decision: "PENDING" });

    await expect(service.decideItem("tenant-a", "ORGANIZATION", "review-1", "item-1", "reviewer-1", "EXCEPTION"))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(db.idpPrisma.$transaction).not.toHaveBeenCalled();
  });
});
