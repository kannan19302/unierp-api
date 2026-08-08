import { Controller, Get, Post, Param, Body, Query } from '@nestjs/common';
import { InvoicingService, CreateCreditNoteDto, AdjustInvoiceDto } from './invoicing.service';

@Controller('platform/v1/invoices')
export class InvoicingController {
  constructor(private readonly invoicing: InvoicingService) {}

  @Get()
  listInvoices(@Query('tenantId') tenantId?: string, @Query('status') status?: string) {
    return this.invoicing.listInvoices(tenantId, status);
  }

  @Get(':id')
  getInvoice(@Param('id') id: string) {
    return this.invoicing.getInvoice(id);
  }

  @Post('credit-notes')
  createCreditNote(@Body() body: CreateCreditNoteDto & { actorId?: string }) {
    return this.invoicing.createCreditNote(body, body.actorId || 'SYSTEM');
  }

  @Post(':id/adjust')
  applyAdjustment(
    @Param('id') id: string,
    @Body() body: AdjustInvoiceDto & { actorId?: string },
  ) {
    return this.invoicing.applyAdjustment(id, body, body.actorId || 'SYSTEM');
  }
}
