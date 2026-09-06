import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import { prisma } from "@kannan19302/database";
import { idpClient as idpPrisma } from "../../../common/idp-client";
import { Prisma } from "@kannan19302/database/prisma";

@Injectable()
export class CashPoolingService {
  private async getPool(tenantId: string, id: string) {
    const pool = await prisma.cashPool.findFirst({
      where: { id, tenantId },
      include: { runs: true },
    });
    if (!pool) throw new NotFoundException("Cash pool not found");
    return pool;
  }

  async createCashPool(
    tenantId: string,
    dto: {
      orgId: string;
      name: string;
      poolType?: string;
      headerAccountId: string;
      participantAccountIds: string[];
      targetBalance?: number;
    },
  ) {
    return prisma.cashPool.create({
      data: {
        tenantId,
        orgId: dto.orgId,
        name: dto.name,
        poolType: dto.poolType ?? "PHYSICAL",
        headerAccountId: dto.headerAccountId,
        participantAccountIds: dto.participantAccountIds as never,
        targetBalance: dto.targetBalance ?? 0,
        isActive: true,
      },
    });
  }

  async getCashPool(tenantId: string, id: string) {
    return this.getPool(tenantId, id);
  }

  async listCashPools(tenantId: string) {
    return prisma.cashPool.findMany({
      where: { tenantId, isActive: true },
    });
  }

  async poolConcentrationRun(tenantId: string, poolId: string) {
    const pool = await this.getPool(tenantId, poolId);
    if (!pool.isActive)
      throw new BadRequestException("Cash pool is not active");

    const participantIds = (pool.participantAccountIds as string[]) || [];
    let totalSwept = 0;
    const details: any[] = [];

    // Sweep all balances exceeding targetBalance to concentration header account
    for (const acctId of participantIds) {
      const acct = await prisma.bankAccount.findFirst({
        where: { id: acctId, tenantId },
      });
      if (!acct) continue;
      
      let balance = 0;
      if (acct.accountId && prisma.journalEntry?.aggregate) {
        const journalAgg = await prisma.journalEntry.aggregate({
          where: {
            tenantId,
            accountId: acct.accountId,
            journal: { status: "POSTED" },
          },
          _sum: { debit: true, credit: true },
        });
        balance =
          Number(journalAgg?._sum?.debit ?? 0) -
          Number(journalAgg?._sum?.credit ?? 0);
      }

      const excess = balance - Number(pool.targetBalance);
      if (excess > 0) {
        totalSwept += excess;
        details.push({ bankAccountId: acctId, sweptAmount: excess });
      }
    }

    const run = await prisma.cashPoolRun.create({
      data: {
        tenantId,
        cashPoolId: poolId,
        runType: "SWEEP",
        totalSwept,
        details: details as never,
      },
    });

    // Post GL swept journal
    if (totalSwept > 0) {
      const journal = await prisma.journal.create({
        data: {
          tenantId,
          orgId: pool.orgId,
          entryNumber: `JRN-SWP-${Date.now()}`,
          date: new Date(),
          status: "POSTED",
          notes: `GL Sweep Concentration for pool: ${pool.name}`,
        },
      });
      // Debit Concentration Header account, Credit Participant accounts
      await prisma.journalEntry.createMany({
        data: [
          {
            tenantId,
            journalId: journal.id,
            accountId: pool.headerAccountId,
            debit: new Prisma.Decimal(totalSwept),
            credit: new Prisma.Decimal(0),
            description: `Sweep Concentration debit header account ${pool.headerAccountId}`,
          },
          {
            tenantId,
            journalId: journal.id,
            accountId: "acc-participant-pool-clearing",
            debit: new Prisma.Decimal(0),
            credit: new Prisma.Decimal(totalSwept),
            description: `Sweep Concentration credit participant account clearing`,
          },
        ],
      });
      await prisma.cashPoolRun.update({
        where: { id: run.id },
        data: { glJournalId: journal.id },
      });
    }

    return run;
  }

  async poolRedistributionRun(tenantId: string, poolId: string) {
    const pool = await this.getPool(tenantId, poolId);
    if (!pool.isActive)
      throw new BadRequestException("Cash pool is not active");

    const participantIds = (pool.participantAccountIds as string[]) || [];
    let totalFunded = 0;
    const details: any[] = [];

    // Fund participant accounts that fall below the targetBalance from Concentration header account
    for (const acctId of participantIds) {
      const acct = await prisma.bankAccount.findFirst({
        where: { id: acctId, tenantId },
      });
      if (!acct) continue;
      
      let balance = 0;
      if (acct.accountId && prisma.journalEntry?.aggregate) {
        const journalAgg = await prisma.journalEntry.aggregate({
          where: {
            tenantId,
            accountId: acct.accountId,
            journal: { status: "POSTED" },
          },
          _sum: { debit: true, credit: true },
        });
        balance =
          Number(journalAgg?._sum?.debit ?? 0) -
          Number(journalAgg?._sum?.credit ?? 0);
      }

      const target = Number(pool.targetBalance) || 0;
      const deficit = target - balance;
      if (deficit > 0) {
        totalFunded += deficit;
        details.push({ bankAccountId: acctId, sweptAmount: -deficit });
      }
    }

    const run = await prisma.cashPoolRun.create({
      data: {
        tenantId,
        cashPoolId: poolId,
        runType: "FUNDING",
        totalSwept: -totalFunded,
        details: details as never,
      },
    });

    return run;
  }

  async simulateConcentrationSweep(tenantId: string, poolId: string) {
    const pool = await this.getPool(tenantId, poolId);
    const participantIds = (pool.participantAccountIds as string[]) || [];

    const headerAcct = await prisma.bankAccount.findFirst({
      where: { id: pool.headerAccountId, tenantId },
    });
    let headerBalance = 0;
    if (headerAcct?.accountId && prisma.journalEntry?.aggregate) {
      const headerAgg = await prisma.journalEntry.aggregate({
        where: {
          tenantId,
          accountId: headerAcct.accountId,
          journal: { status: "POSTED" },
        },
        _sum: { debit: true, credit: true },
      });
      headerBalance =
        Number(headerAgg?._sum?.debit ?? 0) -
        Number(headerAgg?._sum?.credit ?? 0);
    }

    const participants: Array<{
      bankAccountId: string;
      bankName: string;
      accountNumber: string;
      currentBalance: number;
      targetBalance: number;
      variance: number;
      action: "SWEEP_TO_HEADER" | "FUND_FROM_HEADER" | "SQUARE";
      transferAmount: number;
    }> = [];

    let totalSweptUp = 0;
    let totalFundedDown = 0;

    for (const acctId of participantIds) {
      const acct = await prisma.bankAccount.findFirst({
        where: { id: acctId, tenantId },
      });
      if (!acct) continue;

      let currentBalance = 0;
      if (acct.accountId && prisma.journalEntry?.aggregate) {
        const journalAgg = await prisma.journalEntry.aggregate({
          where: {
            tenantId,
            accountId: acct.accountId,
            journal: { status: "POSTED" },
          },
          _sum: { debit: true, credit: true },
        });
        currentBalance =
          Number(journalAgg?._sum?.debit ?? 0) -
          Number(journalAgg?._sum?.credit ?? 0);
      }

      const target = Number(pool.targetBalance) || 0;
      const variance = currentBalance - target;

      let action: "SWEEP_TO_HEADER" | "FUND_FROM_HEADER" | "SQUARE" = "SQUARE";
      let transferAmount = 0;

      if (variance > 0) {
        action = "SWEEP_TO_HEADER";
        transferAmount = variance;
        totalSweptUp += variance;
      } else if (variance < 0) {
        action = "FUND_FROM_HEADER";
        transferAmount = Math.abs(variance);
        totalFundedDown += Math.abs(variance);
      }

      participants.push({
        bankAccountId: acct.id,
        bankName: acct.bankName,
        accountNumber: acct.accountNumber,
        currentBalance,
        targetBalance: target,
        variance,
        action,
        transferAmount,
      });
    }

    const netMobilized = totalSweptUp - totalFundedDown;
    const projectedHeaderBalance = headerBalance + netMobilized;

    return {
      poolId: pool.id,
      poolName: pool.name,
      poolType: pool.poolType,
      targetBalance: Number(pool.targetBalance),
      headerAccountId: pool.headerAccountId,
      headerAccountName: headerAcct?.bankName ?? "Concentration Header Account",
      currentHeaderBalance: headerBalance,
      projectedHeaderBalance,
      totalSweptUp,
      totalFundedDown,
      netMobilized,
      participants,
    };
  }

  async listPoolRuns(tenantId: string, poolId: string) {
    return prisma.cashPoolRun.findMany({
      where: { tenantId, cashPoolId: poolId },
      orderBy: { runDate: "desc" },
    });
  }

  // ── VARIANCE ALERT CONFIGS ─────────────────────────────

  async createVarianceAlertConfig(
    tenantId: string,
    dto: {
      accountId: string;
      thresholdPct: number;
      ownerId: string;
    },
  ) {
    return prisma.varianceAlertConfig.upsert({
      where: { tenantId_accountId: { tenantId, accountId: dto.accountId } },
      create: {
        tenantId,
        accountId: dto.accountId,
        thresholdPct: dto.thresholdPct,
        ownerId: dto.ownerId,
        isActive: true,
      },
      update: { thresholdPct: dto.thresholdPct, ownerId: dto.ownerId },
    });
  }

  async getBudgetVarianceAlerts(tenantId: string) {
    const configs = await prisma.varianceAlertConfig.findMany({
      where: { tenantId, isActive: true },
    });
    const alerts: any[] = [];

    for (const config of configs) {
      // Mock calculation for PNL vs Budget comparison
      const actual = 120000;
      const budget = 100000;
      const pct = ((actual - budget) / budget) * 100;
      if (pct > Number(config.thresholdPct)) {
        alerts.push({
          accountId: config.accountId,
          actual,
          budget,
          variancePct: pct.toFixed(2),
          thresholdPct: config.thresholdPct,
          ownerId: config.ownerId,
          severity:
            pct > Number(config.thresholdPct) * 1.5 ? "CRITICAL" : "WARNING",
        });
      }
    }

    return { alertCount: alerts.length, alerts };
  }
}
