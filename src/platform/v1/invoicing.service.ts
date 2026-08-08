import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { prisma } from '@kannan19302/database';
import { ControlPlaneAuditService } from './control-plane-audit.service';

export interface CreateCreditNoteDto {
  invoiceId: string;
  amount: number;
  reason: string;
}

export interface AdjustInvoiceDto {
  amount: number;
  type: 'REFUND' | 'WRITE_OFF' | 'MANUAL_DISCOUNT';
  reason: string;
}

@Injectable()
export class InvoicingService {
  private readonly logger = new Logger(InvoicingService.name);

  constructor(private readonly audit: ControlPlaneAuditService) {}

  /**
   * Financial arithmetic for tax & total calculation
   */
  calculateInvoiceTotals(subtotal: number, taxRatePct: number = 0, discountAmount: number = 0) {
    const discountedSubtotal = Math.max(0, subtotal - discountAmount);
    const taxAmount = Math.round(discountedSubtotal * (taxRatePct / 100) * 100) / 100;
    const totalAmount = Math.round((discountedSubtotal + taxAmount) * 100) / 100;
    return { subtotal, discountAmount, taxAmount, totalAmount };
  }

  async listInvoices(tenantId?: string, status?: string) {
    const where: any = {};
    if (tenantId) where.tenantId = tenantId;
    if (status) where.status = status;

    return prisma.saaSInvoice.findMany({
      where,
      include: { lines: true, tenant: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getInvoice(id: string) {
    return prisma.saaSInvoice.findUniqueOrThrow({
      where: { id },
      include: { lines: true, tenant: true, transactions: true },
    });
  }

  /**
   * Implements C16 exit criterion: "An incorrect invoice is correctable by credit note, never by mutation."
   */
  async createCreditNote(dto: CreateCreditNoteDto, approverId: string) {
    if (!dto.reason || dto.reason.length < 5) {
      throw new BadRequestException('An explicit reason is required to issue a credit note');
    }

    return prisma.$transaction(async (tx) => {
      const original = await tx.saaSInvoice.findUniqueOrThrow({
        where: { id: dto.invoiceId },
      });

      const creditNoteNumber = `CN-${original.invoiceNumber.replace('INV-', '')}-${Date.now().toString().slice(-4)}`;

      // Create Credit Note Invoice entry
      const creditNote = await tx.saaSInvoice.create({
        data: {
          tenantId: original.tenantId,
          subscriptionId: original.subscriptionId,
          invoiceNumber: creditNoteNumber,
          status: 'PAID',
          currency: original.currency,
          subtotal: -Math.abs(dto.amount),
          totalAmount: -Math.abs(dto.amount),
          amountPaid: -Math.abs(dto.amount),
          amountDue: 0,
          notes: `Credit Note for Invoice ${original.invoiceNumber}. Reason: ${dto.reason} (Approved by ${approverId})`,
          lines: {
            create: [
              {
                description: `Credit Note adjustment for ${original.invoiceNumber}`,
                type: 'CREDIT',
                quantity: 1,
                unitPrice: -Math.abs(dto.amount),
                totalPrice: -Math.abs(dto.amount),
              },
            ],
          },
        },
      });

      await this.audit.record(
        {
          actorId: approverId,
          actorRole: 'SUPER_ADMIN',
          action: 'invoice.credit_note.create',
          targetId: original.id,
          details: { creditNoteId: creditNote.id, amount: dto.amount, reason: dto.reason },
        },
        tx as any,
      );

      return creditNote;
    });
  }

  async applyAdjustment(invoiceId: string, dto: AdjustInvoiceDto, approverId: string) {
    if (!dto.reason || dto.reason.length < 5) {
      throw new BadRequestException('An explicit reason and approver are required for invoice adjustments');
    }

    return prisma.$transaction(async (tx) => {
      const invoice = await tx.saaSInvoice.findUniqueOrThrow({ where: { id: invoiceId } });

      let newStatus = invoice.status;
      if (dto.type === 'WRITE_OFF') {
        newStatus = 'CANCELLED';
      }

      // Record adjustment transaction
      const line = await tx.saaSInvoiceLineItem.create({
        data: {
          invoiceId,
          description: `Adjustment (${dto.type}): ${dto.reason}`,
          type: dto.type === 'REFUND' ? 'CREDIT' : dto.type,
          quantity: 1,
          unitPrice: -Math.abs(dto.amount),
          totalPrice: -Math.abs(dto.amount),
        },
      });

      await tx.saaSInvoice.update({
        where: { id: invoiceId },
        data: {
          status: newStatus,
          notes: `${invoice.notes || ''}\n[Adjustment ${dto.type} of ${dto.amount} by ${approverId}: ${dto.reason}]`.trim(),
        },
      });

      await this.audit.record(
        {
          actorId: approverId,
          actorRole: 'SUPER_ADMIN',
          action: `invoice.adjustment.${dto.type.toLowerCase()}`,
          targetId: invoiceId,
          details: { dto, approverId },
        },
        tx as any,
      );

      return line;
    });
  }
}
