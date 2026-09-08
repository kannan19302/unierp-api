import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import { prisma } from "@kannan19302/database";
import { idpClient as idpPrisma } from "../../../common/idp-client";
import { Prisma } from "@kannan19302/database/prisma";

@Injectable()
export class FinanceDemoDataService {
  /**
   * Get current demo data status for Finance module.
   */
  async getDemoStatus(tenantId: string) {
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw new NotFoundException("Tenant not found");

    const records = await prisma.demoDataRecord.groupBy({
      by: ["entityType"],
      where: { tenantId, module: "finance" },
      _count: { id: true },
    });

    const entityCounts: Record<string, number> = {};
    let totalRecords = 0;
    for (const r of records) {
      entityCounts[r.entityType] = r._count.id;
      totalRecords += r._count.id;
    }

    return {
      loaded: totalRecords > 0,
      totalRecords,
      entityCounts,
      module: "finance",
    };
  }

  /**
   * Load sample demo data exclusively for Finance module.
   */
  async loadFinanceDemoData(tenantId: string, orgId?: string) {
    const status = await this.getDemoStatus(tenantId);
    if (status.loaded) {
      throw new BadRequestException(
        "Finance demo data is already loaded for this workspace.",
      );
    }

    const org = await prisma.organization.findFirst({ where: { tenantId } });
    const effectiveOrgId = orgId || org?.id || "org-system-default";
    const now = new Date();
    const createdRecords: Array<{ entityType: string; entityId: string }> = [];

    await prisma.$transaction(async (tx) => {
      // Find or create a demo customer for binding
      let demoCustomer = await tx.customer.findFirst({ where: { tenantId } });
      if (!demoCustomer) {
        demoCustomer = await tx.customer.create({
          data: {
            tenantId,
            orgId: effectiveOrgId,
            name: "Acme Corporation (Demo)",
            type: "COMPANY",
            email: "demo@acme-corp.com",
          },
        });
        createdRecords.push({
          entityType: "customer",
          entityId: demoCustomer.id,
        });
      }

      // 1. Seed Sample Invoices
      const sampleInvoices = [
        {
          invoiceNumber: "INV-DEMO-001",
          amount: 4500,
          paidAmount: 4500,
          status: "PAID",
          daysAgo: 45,
        },
        {
          invoiceNumber: "INV-DEMO-002",
          amount: 12800,
          paidAmount: 0,
          status: "SENT",
          daysAgo: 15,
        },
        {
          invoiceNumber: "INV-DEMO-003",
          amount: 8400,
          paidAmount: 2400,
          status: "PARTIALLY_PAID",
          daysAgo: 60,
        },
        {
          invoiceNumber: "INV-DEMO-004",
          amount: 3100,
          paidAmount: 0,
          status: "OVERDUE",
          daysAgo: 75,
        },
        {
          invoiceNumber: "INV-DEMO-005",
          amount: 19500,
          paidAmount: 0,
          status: "DRAFT",
          daysAgo: 2,
        },
      ];

      for (const inv of sampleInvoices) {
        const issueDate = new Date(now.getTime() - inv.daysAgo * 86400000);
        const dueDate = new Date(issueDate.getTime() + 30 * 86400000);

        const createdInv = await tx.invoice.create({
          data: {
            tenantId,
            orgId: effectiveOrgId,
            customerId: demoCustomer.id,
            invoiceNumber: inv.invoiceNumber,
            status: inv.status as any,
            issueDate,
            dueDate,
            subtotal: new Prisma.Decimal(inv.amount * 0.9),
            taxAmount: new Prisma.Decimal(inv.amount * 0.1),
            totalAmount: new Prisma.Decimal(inv.amount),
            paidAmount: new Prisma.Decimal(inv.paidAmount),
            currency: "USD",
            notes: "Seeded demo data invoice",
          },
        });

        createdRecords.push({ entityType: "invoice", entityId: createdInv.id });

        // Seed payment if paid/partial
        if (inv.paidAmount > 0) {
          const createdPayment = await tx.payment.create({
            data: {
              tenantId,
              invoiceId: createdInv.id,
              amount: new Prisma.Decimal(inv.paidAmount),
              paidAt: new Date(issueDate.getTime() + 10 * 86400000),
              method: "CARD",
              reference: `PAY-DEMO-${createdInv.id.slice(0, 6)}`,
            },
          });
          createdRecords.push({
            entityType: "payment",
            entityId: createdPayment.id,
          });
        }
      }

      // 2. Seed Realistic Aged Invoices for AR Aging Breakdown
      const agedInvoices = [
        {
          num: "INV-AR-CURR",
          amt: 682550,
          status: "SENT",
          dueDaysFromNow: 20,
        },
        {
          num: "INV-AR-30D",
          amt: 78600,
          status: "OVERDUE",
          dueDaysFromNow: -14,
        },
        {
          num: "INV-AR-60D",
          amt: 45300,
          status: "OVERDUE",
          dueDaysFromNow: -42,
        },
        {
          num: "INV-AR-90D",
          amt: 22100,
          status: "OVERDUE",
          dueDaysFromNow: -72,
        },
        {
          num: "INV-AR-90PLUS",
          amt: 14350,
          status: "OVERDUE",
          dueDaysFromNow: -105,
        },
      ];

      for (const aInv of agedInvoices) {
        const dueDate = new Date(now.getTime() + aInv.dueDaysFromNow * 86400000);
        const issueDate = new Date(dueDate.getTime() - 30 * 86400000);

        const createdAged = await tx.invoice.create({
          data: {
            tenantId,
            orgId: effectiveOrgId,
            customerId: demoCustomer.id,
            invoiceNumber: aInv.num,
            status: aInv.status as any,
            issueDate,
            dueDate,
            subtotal: new Prisma.Decimal(aInv.amt * 0.9),
            taxAmount: new Prisma.Decimal(aInv.amt * 0.1),
            totalAmount: new Prisma.Decimal(aInv.amt),
            paidAmount: new Prisma.Decimal(0),
            currency: "USD",
            notes: "Seeded AR aging distribution invoice",
          },
        });
        createdRecords.push({
          entityType: "invoice",
          entityId: createdAged.id,
        });
      }

      // 3. Seed Financial Period & Month-End Close Checklist Tasks
      if (tx.financialPeriod) {
        let activePeriod = await tx.financialPeriod.findFirst({
          where: { tenantId, status: "OPEN" },
        });
        if (!activePeriod) {
          activePeriod = await tx.financialPeriod.create({
            data: {
              tenantId,
              orgId: effectiveOrgId,
              name: "FY2026-Q3",
              startDate: new Date("2026-07-01"),
              endDate: new Date("2026-09-30"),
              status: "OPEN",
            },
          });
          createdRecords.push({
            entityType: "financialPeriod",
            entityId: activePeriod.id,
          });
        }

        const standardCloseTasks = [
          { name: "Post all recurring journals", status: "DONE", owner: "AB", dueDays: -2 },
          { name: "Reconcile bank accounts", status: "DONE", owner: "CD", dueDays: -2 },
          { name: "Review and approve AP accruals", status: "DONE", owner: "EF", dueDays: -1 },
          { name: "Review and approve AR adjustments", status: "DONE", owner: "GH", dueDays: -1 },
          { name: "Validate intercompany balances", status: "DONE", owner: "IJ", dueDays: 0 },
          { name: "Review tax provision", status: "IN_PROGRESS", owner: "KL", dueDays: 2 },
        ];

        if (tx.closeTask && activePeriod) {
          for (const ct of standardCloseTasks) {
            const dueDate = new Date(now.getTime() + ct.dueDays * 86400000);
            const task = await tx.closeTask.create({
              data: {
                tenantId,
                financialPeriodId: activePeriod.id,
                name: ct.name,
                assigneeId: ct.owner,
                status: ct.status,
                dueDate,
                createdBy: "demo-system",
                updatedBy: "demo-system",
              },
            });
            createdRecords.push({
              entityType: "closeTask",
              entityId: task.id,
            });
          }
        }
      }

      // 4. Seed Unmatched Bank Transactions (for Exceptions triage)
      if (tx.bankConnection && tx.bankTransaction) {
        let connection = await tx.bankConnection.findFirst({
          where: { tenantId },
        });
        if (!connection) {
          const bankAcc = tx.bankAccount ? await tx.bankAccount.findFirst({ where: { tenantId } }) : null;
          connection = await tx.bankConnection.create({
            data: {
              tenantId,
              orgId: "00000000-0000-0000-0000-000000000001",
              bankName: "JPMorgan Chase Commercial",
              accountNumber: "•••• 8492",
              accountType: "CHECKING",
              credentialsHash: "demo_credentials_hash",
              status: "ACTIVE",
              ...(bankAcc ? { bankAccountId: bankAcc.id } : {}),
            } as any,
          });
          createdRecords.push({
            entityType: "bankConnection",
            entityId: connection.id,
          });
        }

        const sampleBankTxs = [
          { desc: "Incoming wire transfer - Ref #TX-82914", amt: 24500.0, daysAgo: 10 },
          { desc: "ACH Vendor settlement discrepancy", amt: -18280.0, daysAgo: 6 },
          { desc: "Corporate merchant credit fee variance", amt: -22000.0, daysAgo: 2 },
        ];

        for (const btx of sampleBankTxs) {
          const txDate = new Date(now.getTime() - btx.daysAgo * 86400000);
          const createdTx = await tx.bankTransaction.create({
            data: {
              tenantId,
              connectionId: connection.id,
              date: txDate,
              description: btx.desc,
              amount: new Prisma.Decimal(btx.amt),
              status: "UNMATCHED",
            },
          });
          createdRecords.push({
            entityType: "bankTransaction",
            entityId: createdTx.id,
          });
        }
      }

      // 5. Seed Draft Journal awaiting manager approval (for Exceptions triage)
      if (tx.account && tx.journal && tx.journalEntry) {
        let operatingAccount = await tx.account.findFirst({
          where: { tenantId, code: "1010" },
        });
        let revAccount = await tx.account.findFirst({
          where: { tenantId, code: "4010" },
        });

        if (operatingAccount && revAccount) {
          const draftJournal = await tx.journal.create({
            data: {
              tenantId,
              orgId: effectiveOrgId,
              entryNumber: "JV-PENDING-001",
              date: new Date(now.getTime() - 2 * 86400000),
              status: "DRAFT",
              notes: "Pending quarterly revenue accrual adjustment",
            },
          });
          createdRecords.push({
            entityType: "journal",
            entityId: draftJournal.id,
          });

          await tx.journalEntry.createMany({
            data: [
              {
                tenantId,
                journalId: draftJournal.id,
                accountId: operatingAccount.id,
                debit: new Prisma.Decimal(154320.0),
                credit: new Prisma.Decimal(0),
                description: "Accrual receivable adjustment",
              },
              {
                tenantId,
                journalId: draftJournal.id,
                accountId: revAccount.id,
                debit: new Prisma.Decimal(0),
                credit: new Prisma.Decimal(154320.0),
                description: "Accrual revenue recognition",
              },
            ],
          });
        }
      }

      // 6. Track demo records in demoDataRecord
      for (const rec of createdRecords) {
        await tx.demoDataRecord.create({
          data: {
            tenantId,
            module: "finance",
            entityType: rec.entityType,
            entityId: rec.entityId,
          },
        });
      }
    });

    return {
      success: true,
      message: `Finance demo data populated successfully (${createdRecords.length} records created).`,
      count: createdRecords.length,
    };
  }

  /**
   * Unload / Safely purge sample demo data exclusively for Finance module.
   */
  async unloadFinanceDemoData(tenantId: string) {
    const records = await prisma.demoDataRecord.findMany({
      where: { tenantId, module: "finance" },
    });

    if (records.length === 0) {
      return {
        success: true,
        message: "No Finance demo data to unload.",
        count: 0,
      };
    }

    let removedCount = 0;

    for (const record of records) {
      try {
        if (record.entityType === "invoice") {
          await prisma.payment.deleteMany({
            where: { invoiceId: record.entityId },
          });
          await prisma.invoice.delete({ where: { id: record.entityId } });
          removedCount++;
        } else if (record.entityType === "payment") {
          await prisma.payment
            .delete({ where: { id: record.entityId } })
            .catch(() => null);
          removedCount++;
        } else if (record.entityType === "customer") {
          await prisma.customer
            .delete({ where: { id: record.entityId } })
            .catch(() => null);
          removedCount++;
        } else if (record.entityType === "closeTask") {
          await prisma.closeTask
            .delete({ where: { id: record.entityId } })
            .catch(() => null);
          removedCount++;
        } else if (record.entityType === "bankTransaction") {
          await prisma.bankTransaction
            .delete({ where: { id: record.entityId } })
            .catch(() => null);
          removedCount++;
        } else if (record.entityType === "bankConnection") {
          await prisma.bankConnection
            .delete({ where: { id: record.entityId } })
            .catch(() => null);
          removedCount++;
        } else if (record.entityType === "journal") {
          await prisma.journalEntry.deleteMany({
            where: { journalId: record.entityId },
          });
          await prisma.journal
            .delete({ where: { id: record.entityId } })
            .catch(() => null);
          removedCount++;
        } else if (record.entityType === "financialPeriod") {
          await prisma.financialPeriod
            .delete({ where: { id: record.entityId } })
            .catch(() => null);
          removedCount++;
        }
      } catch {
        // Already deleted or cascaded
      }
    }

    await prisma.demoDataRecord.deleteMany({
      where: { tenantId, module: "finance" },
    });

    return {
      success: true,
      message: `Finance demo data safely unloaded (${removedCount} records removed).`,
      count: removedCount,
    };
  }
}
