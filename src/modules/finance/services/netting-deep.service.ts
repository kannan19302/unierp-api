import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import { prisma } from "@kannan19302/database";
import { idpClient as idpPrisma } from "../../../common/idp-client";
import { Prisma } from "@kannan19302/database/prisma";

@Injectable()
export class NettingDeepService {
  // ── Netting Groups ─────────────────────────────────────────

  async getNettingGroups(tenantId: string) {
    return prisma.nettingGroup.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
    });
  }

  async getNettingGroupById(tenantId: string, id: string) {
    const g = await prisma.nettingGroup.findFirst({
      where: { id, tenantId },
      include: { members: true, runs: true },
    });
    if (!g) throw new NotFoundException("Netting group not found");
    return g;
  }

  async createNettingGroup(tenantId: string, orgId: string, dto: any) {
    return prisma.nettingGroup.create({ data: { ...dto, tenantId, orgId } });
  }

  async updateNettingGroup(tenantId: string, id: string, dto: any) {
    await this.getNettingGroupById(tenantId, id);
    return prisma.nettingGroup.update({ where: { id }, data: dto });
  }

  async deleteNettingGroup(tenantId: string, id: string) {
    await this.getNettingGroupById(tenantId, id);
    return prisma.nettingGroup.delete({ where: { id } });
  }

  async activateNettingGroup(tenantId: string, id: string) {
    await this.getNettingGroupById(tenantId, id);
    return prisma.nettingGroup.update({
      where: { id },
      data: { status: "ACTIVE" },
    });
  }

  async deactivateNettingGroup(tenantId: string, id: string) {
    await this.getNettingGroupById(tenantId, id);
    return prisma.nettingGroup.update({
      where: { id },
      data: { status: "INACTIVE" },
    });
  }

  // ── Netting Group Members ──────────────────────────────────

  async getNettingGroupMembers(tenantId: string, groupId: string) {
    return prisma.nettingGroupMember.findMany({ where: { tenantId, groupId } });
  }

  async addNettingGroupMember(tenantId: string, groupId: string, dto: any) {
    await this.getNettingGroupById(tenantId, groupId);
    return prisma.nettingGroupMember.create({
      data: { ...dto, tenantId, groupId },
    });
  }

  async removeNettingGroupMember(
    tenantId: string,
    groupId: string,
    memberId: string,
  ) {
    const member = await prisma.nettingGroupMember.findFirst({
      where: { id: memberId, tenantId, groupId },
    });
    if (!member) throw new NotFoundException("Netting group member not found");
    return prisma.nettingGroupMember.delete({ where: { id: memberId } });
  }

  async deactivateNettingGroupMember(
    tenantId: string,
    groupId: string,
    memberId: string,
  ) {
    const member = await prisma.nettingGroupMember.findFirst({
      where: { id: memberId, tenantId, groupId },
    });
    if (!member) throw new NotFoundException("Netting group member not found");
    return prisma.nettingGroupMember.update({
      where: { id: memberId },
      data: { isActive: false },
    });
  }

  // ── Netting Runs ───────────────────────────────────────────

  async getNettingRuns(tenantId: string, groupId?: string) {
    const where: any = { tenantId };
    if (groupId) where.groupId = groupId;
    return prisma.nettingRun.findMany({
      where,
      orderBy: { nettingDate: "desc" },
    });
  }

  async getNettingRunById(tenantId: string, id: string) {
    const r = await prisma.nettingRun.findFirst({
      where: { id, tenantId },
      include: { details: true, settlements: true },
    });
    if (!r) throw new NotFoundException("Netting run not found");
    return r;
  }

  async createNettingRun(tenantId: string, groupId: string, dto: any) {
    const group = await this.getNettingGroupById(tenantId, groupId);
    if (group.status !== "ACTIVE")
      throw new BadRequestException("Netting group must be ACTIVE");
    return prisma.nettingRun.create({
      data: {
        ...dto,
        tenantId,
        groupId,
        runNumber: dto.runNumber || `NET-${Date.now()}`,
        nettingDate: new Date(dto.nettingDate),
        totalReceivables: new Prisma.Decimal(dto.totalReceivables || 0),
        totalPayables: new Prisma.Decimal(dto.totalPayables || 0),
        netSettlementAmount: new Prisma.Decimal(
          (dto.totalReceivables || 0) - (dto.totalPayables || 0),
        ),
      },
    });
  }

  async updateNettingRun(tenantId: string, id: string, dto: any) {
    await this.getNettingRunById(tenantId, id);
    const data: any = { ...dto };
    if (dto.nettingDate) data.nettingDate = new Date(dto.nettingDate);
    if (dto.totalReceivables !== undefined || dto.totalPayables !== undefined) {
      const existing = await this.getNettingRunById(tenantId, id);
      const receivables =
        dto.totalReceivables !== undefined
          ? Number(dto.totalReceivables)
          : Number(existing.totalReceivables);
      const payables =
        dto.totalPayables !== undefined
          ? Number(dto.totalPayables)
          : Number(existing.totalPayables);
      data.netSettlementAmount = new Prisma.Decimal(receivables - payables);
    }
    return prisma.nettingRun.update({ where: { id }, data });
  }

  async deleteNettingRun(tenantId: string, id: string) {
    const run = await this.getNettingRunById(tenantId, id);
    if (run.status !== "DRAFT")
      throw new BadRequestException("Only draft runs can be deleted");
    return prisma.nettingRun.delete({ where: { id } });
  }

  async approveNettingRun(tenantId: string, id: string, approvedBy: string) {
    const run = await this.getNettingRunById(tenantId, id);
    if (run.status !== "PENDING_APPROVAL")
      throw new BadRequestException("Run must be pending approval");
    return prisma.nettingRun.update({
      where: { id },
      data: { status: "APPROVED", approvedBy, approvedAt: new Date() },
    });
  }

  async submitNettingRunForApproval(tenantId: string, id: string) {
    const run = await this.getNettingRunById(tenantId, id);
    if (run.status !== "DRAFT")
      throw new BadRequestException("Only draft runs can be submitted");
    return prisma.nettingRun.update({
      where: { id },
      data: { status: "PENDING_APPROVAL" },
    });
  }

  async cancelNettingRun(tenantId: string, id: string) {
    const run = await this.getNettingRunById(tenantId, id);
    if (run.status === "SETTLED")
      throw new BadRequestException("Cannot cancel a settled run");
    return prisma.nettingRun.update({
      where: { id },
      data: { status: "CANCELLED" },
    });
  }

  async computeNettingRun(tenantId: string, runId: string) {
    const run = await this.getNettingRunById(tenantId, runId);
    if (run.status !== "DRAFT")
      throw new BadRequestException("Only draft runs can be computed");

    const group = await prisma.nettingGroup.findFirst({
      where: { id: run.groupId, tenantId },
      include: { members: { where: { isActive: true } } },
    });
    if (!group) throw new NotFoundException("Netting group not found");

    const members = group.members;
    const intercompanyTransactions =
      await prisma.interCompanyTransaction.findMany({
        where: {
          tenantId,
          status: "PENDING",
          fromOrgId: { in: members.map((m) => m.orgId) },
          toOrgId: { in: members.map((m) => m.orgId) },
        },
      });

    const details: any[] = [];
    let totalReceivables = 0;
    let totalPayables = 0;

    for (const tx of intercompanyTransactions) {
      const amount = Number(tx.amount);
      const baseAmount = amount;
      await prisma.interCompanyTransaction.update({
        where: { id: tx.id },
        data: { status: "MATCHED" },
      });

      if (group.nettingMethod === "BILATERAL") {
        const fromOrg = members.find((m) => m.orgId === tx.fromOrgId);
        const toOrg = members.find((m) => m.orgId === tx.toOrgId);
        if (fromOrg) totalPayables += baseAmount;
        if (toOrg) totalReceivables += baseAmount;
        details.push({
          tenantId,
          fromOrgId: tx.fromOrgId,
          toOrgId: tx.toOrgId,
          transactionId: tx.id,
          originalAmount: new Prisma.Decimal(amount),
          nettedAmount: new Prisma.Decimal(baseAmount),
          currency: tx.currency,
          baseAmount: new Prisma.Decimal(baseAmount),
        });
      } else {
        totalReceivables += baseAmount;
        totalPayables += baseAmount;
        details.push({
          tenantId,
          fromOrgId: tx.fromOrgId,
          toOrgId: tx.toOrgId,
          transactionId: tx.id,
          originalAmount: new Prisma.Decimal(amount),
          nettedAmount: new Prisma.Decimal(baseAmount),
          currency: tx.currency,
          baseAmount: new Prisma.Decimal(baseAmount),
        });
      }
    }

    const netAmount = totalReceivables - totalPayables;

    await prisma.nettingRunDetail.deleteMany({
      where: { nettingRunId: runId },
    });
    if (details.length > 0) {
      await prisma.nettingRunDetail.createMany({ data: details });
    }

    return prisma.nettingRun.update({
      where: { id: runId },
      data: {
        totalReceivables: new Prisma.Decimal(totalReceivables),
        totalPayables: new Prisma.Decimal(totalPayables),
        netSettlementAmount: new Prisma.Decimal(Math.abs(netAmount)),
        details: { createMany: { data: details } },
      },
      include: { details: true },
    });
  }

  async getNettingRunStats(tenantId: string, groupId: string) {
    const runs = await prisma.nettingRun.findMany({
      where: { tenantId, groupId },
    });
    const totalReceivables = runs.reduce(
      (s, r) => s + Number(r.totalReceivables),
      0,
    );
    const totalPayables = runs.reduce((s, r) => s + Number(r.totalPayables), 0);
    const settledCount = runs.filter((r) => r.status === "SETTLED").length;
    return {
      totalRuns: runs.length,
      settledRuns: settledCount,
      pendingRuns: runs.filter(
        (r) => r.status === "PENDING_APPROVAL" || r.status === "APPROVED",
      ).length,
      draftRuns: runs.filter((r) => r.status === "DRAFT").length,
      totalReceivables,
      totalPayables,
      totalNetAmount: totalReceivables - totalPayables,
    };
  }

  // ── Settlement Instructions ────────────────────────────────

  async getSettlementInstructions(
    tenantId: string,
    nettingRunId?: string,
    status?: string,
  ) {
    const where: any = { tenantId };
    if (nettingRunId) where.nettingRunId = nettingRunId;
    if (status) where.status = status;
    return prisma.settlementInstruction.findMany({
      where,
      orderBy: { createdAt: "desc" },
    });
  }

  async getSettlementInstructionById(tenantId: string, id: string) {
    const s = await prisma.settlementInstruction.findFirst({
      where: { id, tenantId },
    });
    if (!s) throw new NotFoundException("Settlement instruction not found");
    return s;
  }

  async createSettlementInstruction(
    tenantId: string,
    nettingRunId: string,
    dto: any,
  ) {
    await this.getNettingRunById(tenantId, nettingRunId);
    return prisma.settlementInstruction.create({
      data: {
        ...dto,
        tenantId,
        nettingRunId,
        settlementAmount: new Prisma.Decimal(dto.settlementAmount),
        expectedSettlementDate: dto.expectedSettlementDate
          ? new Date(dto.expectedSettlementDate)
          : null,
      },
    });
  }

  async updateSettlementInstruction(tenantId: string, id: string, dto: any) {
    await this.getSettlementInstructionById(tenantId, id);
    const data: any = { ...dto };
    if (dto.settlementAmount)
      data.settlementAmount = new Prisma.Decimal(dto.settlementAmount);
    if (dto.expectedSettlementDate !== undefined)
      data.expectedSettlementDate = dto.expectedSettlementDate
        ? new Date(dto.expectedSettlementDate)
        : null;
    if (dto.actualSettlementDate !== undefined)
      data.actualSettlementDate = dto.actualSettlementDate
        ? new Date(dto.actualSettlementDate)
        : null;
    return prisma.settlementInstruction.update({ where: { id }, data });
  }

  async executeSettlementInstruction(tenantId: string, id: string) {
    const inst = await this.getSettlementInstructionById(tenantId, id);
    if (inst.status !== "PENDING")
      throw new BadRequestException(
        "Only pending instructions can be executed",
      );
    return prisma.settlementInstruction.update({
      where: { id },
      data: { status: "EXECUTED", actualSettlementDate: new Date() },
    });
  }

  async confirmSettlementInstruction(
    tenantId: string,
    id: string,
    confirmationRef?: string,
  ) {
    const inst = await this.getSettlementInstructionById(tenantId, id);
    if (inst.status !== "EXECUTED")
      throw new BadRequestException(
        "Only executed instructions can be confirmed",
      );
    return prisma.settlementInstruction.update({
      where: { id },
      data: { status: "CONFIRMED", confirmationRef, confirmedAt: new Date() },
    });
  }

  async failSettlementInstruction(
    tenantId: string,
    id: string,
    errorMessage?: string,
  ) {
    await this.getSettlementInstructionById(tenantId, id);
    return prisma.settlementInstruction.update({
      where: { id },
      data: { status: "FAILED", errorMessage },
    });
  }

  async deleteSettlementInstruction(tenantId: string, id: string) {
    await this.getSettlementInstructionById(tenantId, id);
    return prisma.settlementInstruction.delete({ where: { id } });
  }

  async settleNettingRun(tenantId: string, runId: string) {
    const run = await this.getNettingRunById(tenantId, runId);
    if (run.status !== "APPROVED")
      throw new BadRequestException("Run must be approved before settlement");
    if (run.settlements.length > 0) {
      for (const settlement of run.settlements) {
        if (settlement.status === "PENDING") {
          await prisma.settlementInstruction.update({
            where: { id: settlement.id },
            data: { status: "EXECUTED", actualSettlementDate: new Date() },
          });
        }
      }
    }
    return prisma.nettingRun.update({
      where: { id: runId },
      data: { status: "SETTLED" },
    });
  }

  async getSettlementSummary(tenantId: string, runId: string) {
    const run = await this.getNettingRunById(tenantId, runId);
    const settlements = run.settlements || [];
    return {
      nettingRunId: runId,
      totalSettlements: settlements.length,
      pendingCount: settlements.filter((s) => s.status === "PENDING").length,
      executedCount: settlements.filter((s) => s.status === "EXECUTED").length,
      confirmedCount: settlements.filter((s) => s.status === "CONFIRMED")
        .length,
      failedCount: settlements.filter((s) => s.status === "FAILED").length,
      totalSettlementAmount: settlements.reduce(
        (sum, s) => sum + Number(s.settlementAmount),
        0,
      ),
    };
  }

  // ── Netting Dashboard ──────────────────────────────────────

  async getNettingDashboard(tenantId: string, orgId: string) {
    const groups = await prisma.nettingGroup.findMany({
      where: { tenantId, orgId },
    });
    const groupIds = groups.map((g) => g.id);
    const runs = await prisma.nettingRun.findMany({
      where: { tenantId, groupId: { in: groupIds } },
    });
    const settlements = await prisma.settlementInstruction.findMany({
      where: { tenantId },
    });
    return {
      totalGroups: groups.length,
      activeGroups: groups.filter((g) => g.status === "ACTIVE").length,
      totalRuns: runs.length,
      settledRuns: runs.filter((r) => r.status === "SETTLED").length,
      pendingApprovalRuns: runs.filter((r) => r.status === "PENDING_APPROVAL")
        .length,
      draftRuns: runs.filter((r) => r.status === "DRAFT").length,
      totalSettlements: settlements.length,
      pendingSettlements: settlements.filter((s) => s.status === "PENDING")
        .length,
      confirmedSettlements: settlements.filter((s) => s.status === "CONFIRMED")
        .length,
      totalSettlementAmount: settlements.reduce(
        (s, inst) => s + Number(inst.settlementAmount),
        0,
      ),
    };
  }

  // ── Multilateral Netting Settlement Matrix ─────────────────

  async computeMultilateralMatrix(tenantId: string, runId: string) {
    const run = await prisma.nettingRun.findFirst({
      where: { id: runId, tenantId },
      include: { details: true },
    });
    if (!run) throw new NotFoundException("Netting run not found");

    const participants = new Set<string>();
    const details = run.details || [];

    for (const d of details) {
      if (d.fromOrgId) participants.add(d.fromOrgId);
      if (d.toOrgId) participants.add(d.toOrgId);
    }

    const participantList = Array.from(participants);
    const pairwiseMatrix: Record<string, Record<string, number>> = {};
    for (const p of participantList) {
      pairwiseMatrix[p] = {};
      for (const q of participantList) {
        pairwiseMatrix[p][q] = 0;
      }
    }

    let grossVolume = 0;
    let grossTransactionCount = 0;

    for (const d of details) {
      const amt = Number(d.baseAmount ?? d.nettedAmount ?? d.originalAmount ?? 0);
      if (amt > 0 && d.fromOrgId && d.toOrgId) {
        if (!pairwiseMatrix[d.fromOrgId]) {
          pairwiseMatrix[d.fromOrgId] = {};
        }
        pairwiseMatrix[d.fromOrgId]![d.toOrgId] =
          (pairwiseMatrix[d.fromOrgId]![d.toOrgId] || 0) + amt;
        grossVolume += amt;
        grossTransactionCount += 1;
      }
    }

    const positions: Array<{
      orgId: string;
      grossPayables: number;
      grossReceivables: number;
      netPosition: number;
      role: "PAYER" | "RECEIVER" | "SQUARE";
    }> = [];

    let totalDisbursements = 0;

    for (const orgId of participantList) {
      let grossPayables = 0;
      let grossReceivables = 0;

      for (const other of participantList) {
        grossPayables += pairwiseMatrix[orgId]?.[other] || 0;
        grossReceivables += pairwiseMatrix[other]?.[orgId] || 0;
      }

      const netPosition = grossReceivables - grossPayables;
      const role: "PAYER" | "RECEIVER" | "SQUARE" =
        netPosition < 0 ? "PAYER" : netPosition > 0 ? "RECEIVER" : "SQUARE";

      if (role === "PAYER") {
        totalDisbursements += Math.abs(netPosition);
      }

      positions.push({
        orgId,
        grossPayables,
        grossReceivables,
        netPosition,
        role,
      });
    }

    const settlements: Array<{
      fromOrgId: string;
      toOrgId: string;
      amount: number;
      description: string;
    }> = [];

    for (const p of positions) {
      if (p.role === "PAYER") {
        settlements.push({
          fromOrgId: p.orgId,
          toOrgId: "TREASURY_CENTRE",
          amount: Math.abs(p.netPosition),
          description: `Multilateral net obligation settlement from ${p.orgId} to Treasury Centre`,
        });
      } else if (p.role === "RECEIVER") {
        settlements.push({
          fromOrgId: "TREASURY_CENTRE",
          toOrgId: p.orgId,
          amount: p.netPosition,
          description: `Multilateral net credit disbursement from Treasury Centre to ${p.orgId}`,
        });
      }
    }

    const netTransactionCount = settlements.length;
    const netVolume = totalDisbursements;
    const volumeReductionPercentage =
      grossVolume > 0 ? ((grossVolume - netVolume) / grossVolume) * 100 : 0;
    const transactionsSaved = Math.max(
      0,
      grossTransactionCount - netTransactionCount,
    );

    return {
      runId,
      runNumber: run.runNumber,
      status: run.status,
      grossVolume,
      netVolume,
      volumeReductionPercentage: Number(volumeReductionPercentage.toFixed(2)),
      grossTransactionCount,
      netTransactionCount,
      transactionsSaved,
      participants: participantList,
      pairwiseMatrix,
      positions,
      settlements,
    };
  }
}
