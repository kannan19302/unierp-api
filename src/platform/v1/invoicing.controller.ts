import { Controller, Get, Post, Param, Body, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RbacGuard } from '../../common/guards/rbac.guard';
import { ControlPlaneGuard } from '../../common/guards/control-plane.guard';
import { SkipTenantScope } from '../../common/decorators/skip-tenant-scope.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { TrackChanges } from '../../common/decorators/track-changes.decorator';
import { InvoicingService, CreateCreditNoteDto, AdjustInvoiceDto } from './invoicing.service';

/**
 * Invoicing, credit notes and adjustments (C16's backing surface).
 *
 * M47 / D046: shipped with no guard. `GET /platform/v1/invoices` with no
 * tenantId query returns invoices across every tenant on the platform, and
 * `POST /:id/adjust` mutates a billed amount. Both were open.
 */
@ApiTags('admin')
@ApiBearerAuth()
@Controller('platform/v1/invoices')
@SkipTenantScope()
@UseGuards(JwtAuthGuard, RbacGuard, ControlPlaneGuard)
export class InvoicingController {
  constructor(private readonly invoicing: InvoicingService) {}

  @Get()
  @Permissions('system.invoice.read')
  listInvoices(@Query('tenantId') tenantId?: string, @Query('status') status?: string) {
    return this.invoicing.listInvoices(tenantId, status);
  }

  @Get(':id')
  @Permissions('system.invoice.read')
  getInvoice(@Param('id') id: string) {
    return this.invoicing.getInvoice(id);
  }

  @Post('credit-notes')
  @Permissions('system.invoice.write')
  @TrackChanges('Invoice')
  createCreditNote(@Body() body: CreateCreditNoteDto & { actorId?: string }) {
    return this.invoicing.createCreditNote(body, body.actorId || 'SYSTEM');
  }

  @Post(':id/adjust')
  @Permissions('system.invoice.write')
  @TrackChanges('Invoice')
  applyAdjustment(
    @Param('id') id: string,
    @Body() body: AdjustInvoiceDto & { actorId?: string },
  ) {
    return this.invoicing.applyAdjustment(id, body, body.actorId || 'SYSTEM');
  }
}
