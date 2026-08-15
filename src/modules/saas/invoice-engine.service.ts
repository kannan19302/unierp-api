import { InvoiceHelpers } from "@/modules/saas/shared/billing-shared";
import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import { prisma } from "@kannan19302/database";
import { idpClient as idpPrisma } from "@/common/idp-client";

@Injectable()
export class InvoiceEngineService {
  async listInvoices(tenantId: string, page: number, limit: number, status?: string) { return InvoiceHelpers.listInvoices(tenantId, page, limit, status); }
  async getInvoice(tenantId: string, id: string) { return InvoiceHelpers.getInvoice(tenantId, id); }
  async generateInvoice(tenantId: string, body: any) { return InvoiceHelpers.generateInvoice(tenantId, body); }
  async payInvoice(tenantId: string, id: string) { return InvoiceHelpers.payInvoice(tenantId, id); }
  async refundInvoice(tenantId: string, id: string) { return InvoiceHelpers.refundInvoice(tenantId, id); }
  async cancelInvoice(tenantId: string, id: string) { return InvoiceHelpers.cancelInvoice(tenantId, id); }
  async downloadPdf(tenantId: string, id: string) { return InvoiceHelpers.downloadInvoicePdf(tenantId, id); }
  async getBillingHistory(tenantId: string) {
    const { prisma } = require("@kannan19302/database");
    return prisma.saaSInvoice.findMany({ where: { tenantId }, orderBy: { createdAt: "desc" }, include: { lines: true, transactions: true } });
  }
  async getInvoiceStats(tenantId: string) { return InvoiceHelpers.getInvoiceStats(tenantId); }
  async generateInvoiceNumber() { return InvoiceHelpers.generateInvoiceNumber(); }
  async scheduleRecurringInvoice(tenantId: string, dto: any) {
    const { prisma } = require("@kannan19302/database");
    const { BadRequestException } = require("@nestjs/common");
    const sub = await prisma.tenantSubscription.findFirst({ where: { tenantId } });
    if (!sub) throw new BadRequestException("No active subscription");
    return prisma.tenantSubscription.update({
      where: { id: sub.id },
      data: {
        billingPeriod: dto.interval,
        startDate: dto.startDate ? new Date(dto.startDate) : sub.startDate,
        endDate: dto.endDate ? new Date(dto.endDate) : sub.endDate,
      },
    });
  }
  async getUpcomingInvoices(tenantId: string) { return InvoiceHelpers.getUpcomingInvoices(tenantId); }
}
