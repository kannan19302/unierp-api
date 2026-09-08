import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  UseGuards,
  Req,
  Query,
  UseInterceptors,
} from "@nestjs/common";
import { ZodBody } from "../../../common/decorators/zod-body.decorator";
import { z } from "zod";
import { Request } from "express";
import { JwtAuthGuard } from "../../../common/guards/jwt-auth.guard";
import { RbacGuard } from "../../../common/guards/rbac.guard";
import { Permissions } from "../../../common/decorators/permissions.decorator";
import { FinanceService } from "../services/finance.service";
import { resolveOrgId } from "../../../common/utils/pagination.util";
import { ChangeHistoryInterceptor } from "../../../common/interceptors/change-history.interceptor";
import { TrackChanges } from "../../../common/decorators/track-changes.decorator";
import {
  CreateInvoiceInput,
  UpdateInvoiceInput,
  CreatePaymentInput,
  BulkActionInput,
  createInvoiceSchema,
  updateInvoiceSchema,
  createPaymentSchema,
  bulkActionSchema,
} from "@kannan19302/shared";
import { ApiTags, ApiOperation, ApiBearerAuth } from "@nestjs/swagger";

import { FinanceDemoDataService } from "../services/finance-demo-data.service";

interface AuthenticatedRequest extends Request {
  user: {
    tenantId: string;
    userId: string;
    email: string;
    roles: string[];
    orgId?: string;
  };
}

@ApiTags("finance")
@ApiBearerAuth()
@Controller("finance")
@UseGuards(JwtAuthGuard, RbacGuard)
export class FinanceController {
  constructor(
    private readonly financeService: FinanceService,
    private readonly demoDataService: FinanceDemoDataService,
  ) {}

  // ─── Demo Data Endpoints ────────────────────────────

  @ApiOperation({ summary: "Get Finance demo data status" })
  @Get("demo-data/status")
  @Permissions("finance.read")
  async getDemoDataStatus(@Req() req: AuthenticatedRequest) {
    return this.demoDataService.getDemoStatus(req.user.tenantId);
  }

  @ApiOperation({ summary: "Load Finance module demo data" })
  @Post("demo-data/load")
  @Permissions("finance.settings.write")
  async loadDemoData(@Req() req: AuthenticatedRequest) {
    return this.demoDataService.loadFinanceDemoData(
      req.user.tenantId,
      req.user.orgId,
    );
  }

  @ApiOperation({ summary: "Unload / Purge Finance module demo data" })
  @Post("demo-data/unload")
  @Permissions("finance.settings.write")
  async unloadDemoData(@Req() req: AuthenticatedRequest) {
    return this.demoDataService.unloadFinanceDemoData(req.user.tenantId);
  }

  // ─── Invoice Endpoints ──────────────────────────────

  @ApiOperation({ summary: "Get invoices" })
  @Get("invoices")
  @Permissions("finance.invoice.read")
  async getInvoices(
    @Req() req: AuthenticatedRequest,
    @Query("page") page?: string,
    @Query("limit") limit?: string,
    @Query("sort") sort?: string,
    @Query("search") search?: string,
    @Query("status") status?: string,
    @Query("customerId") customerId?: string,
  ) {
    return this.financeService.getInvoices(req.user.tenantId, {
      page: page ? parseInt(page) : undefined,
      limit: limit ? parseInt(limit) : undefined,
      sort,
      search,
      status,
      customerId,
    });
  }

  @ApiOperation({
    summary: "Get finance executive dashboard data (KPIs + chart datasets)",
  })
  @Get("dashboard")
  @Permissions("finance.invoice.read")
  async getDashboardData(@Req() req: AuthenticatedRequest) {
    return this.financeService.getDashboardData(req.user.tenantId);
  }

  // ─── Strata v2 Screens 2–10 Endpoints ──────────────────────────

  @ApiOperation({ summary: "Get General Ledger summary and recent journals" })
  @Get("gl/summary")
  @Permissions("finance.read")
  async getGlSummary(@Req() req: AuthenticatedRequest) {
    return this.financeService.getGlSummary(req.user.tenantId);
  }

  @ApiOperation({ summary: "Get Accounts Receivable workspace data" })
  @Get("ar/summary")
  @Permissions("finance.read")
  async getArSummary(@Req() req: AuthenticatedRequest) {
    return this.financeService.getArSummary(req.user.tenantId);
  }

  @ApiOperation({ summary: "Get Accounts Payable 3-way match workspace data" })
  @Get("ap/summary")
  @Permissions("finance.read")
  async getApSummary(@Req() req: AuthenticatedRequest) {
    return this.financeService.getApSummary(req.user.tenantId);
  }

  @ApiOperation({ summary: "Get Banking & Treasury reconciliation and forecast" })
  @Get("banking/summary")
  @Permissions("finance.read")
  async getBankingSummary(@Req() req: AuthenticatedRequest) {
    return this.financeService.getBankingSummary(req.user.tenantId);
  }

  @ApiOperation({ summary: "Get Fixed Assets register and depreciation schedule" })
  @Get("assets/summary")
  @Permissions("finance.read")
  async getAssetsSummary(@Req() req: AuthenticatedRequest) {
    return this.financeService.getAssetsSummary(req.user.tenantId);
  }

  @ApiOperation({ summary: "Get Tax & Compliance statutory filing worklist" })
  @Get("tax/summary")
  @Permissions("finance.read")
  async getTaxSummary(@Req() req: AuthenticatedRequest) {
    return this.financeService.getTaxSummary(req.user.tenantId);
  }

  @ApiOperation({ summary: "Get Budget & Planning matrix and forecast drivers" })
  @Get("budget/summary")
  @Permissions("finance.read")
  async getBudgetSummary(
    @Req() req: AuthenticatedRequest,
    @Query("scenario") scenario?: string,
  ) {
    return this.financeService.getBudgetSummary(req.user.tenantId, scenario || "BASE");
  }

  @ApiOperation({ summary: "Get Financial Reports P&L comparative statement" })
  @Get("reports/pnl")
  @Permissions("finance.read")
  async getReportsPnl(
    @Req() req: AuthenticatedRequest,
    @Query("period") period?: string,
  ) {
    return this.financeService.getReportsPnlSummary(req.user.tenantId, period || "2026-08");
  }

  @ApiOperation({ summary: "Get Finance settings and policy context" })
  @Get("settings/overview")
  @Permissions("finance.read")
  async getFinanceSettings(@Req() req: AuthenticatedRequest) {
    return this.financeService.getFinanceSettings(req.user.tenantId);
  }

  @ApiOperation({ summary: "Update Finance settings policies" })
  @Patch("settings/overview")
  @Permissions("finance.settings.write")
  async updateFinanceSettings(
    @Req() req: AuthenticatedRequest,
    @ZodBody(z.any()) dto: any,
  ) {
    return this.financeService.updateFinanceSettings(req.user.tenantId, dto);
  }

  @ApiOperation({ summary: "Approve and post General Ledger journal voucher" })
  @Post("gl/post-journal")
  @Permissions("finance.journal.create")
  async postGlJournal(
    @Req() req: AuthenticatedRequest,
    @ZodBody(z.any()) dto: any,
  ) {
    return this.financeService.postGlJournal(req.user.tenantId, dto);
  }

  @ApiOperation({ summary: "Record payment against Accounts Receivable invoice" })
  @Post("ar/record-payment")
  @Permissions("finance.payment.create")
  async recordArPayment(
    @Req() req: AuthenticatedRequest,
    @ZodBody(z.any()) dto: any,
  ) {
    return this.financeService.recordArPayment(req.user.tenantId, dto);
  }

  @ApiOperation({ summary: "Resolve Accounts Payable 3-way match variance" })
  @Post("ap/resolve-variance")
  @Permissions("finance.invoice.update")
  async resolveApVariance(
    @Req() req: AuthenticatedRequest,
    @ZodBody(z.any()) dto: any,
  ) {
    return this.financeService.resolveApVariance(req.user.tenantId, dto);
  }

  @ApiOperation({ summary: "Schedule and execute Accounts Payable bill payment" })
  @Post("ap/pay-bill")
  @Permissions("finance.payment.create")
  async payApBill(
    @Req() req: AuthenticatedRequest,
    @ZodBody(z.any()) dto: any,
  ) {
    return this.financeService.payApBill(req.user.tenantId, dto);
  }

  @ApiOperation({ summary: "Reconcile bank transaction with ledger record" })
  @Post("banking/reconcile")
  @Permissions("finance.account.create")
  async reconcileBankTransaction(
    @Req() req: AuthenticatedRequest,
    @ZodBody(z.any()) dto: any,
  ) {
    return this.financeService.reconcileBankTransaction(req.user.tenantId, dto);
  }

  @ApiOperation({ summary: "Run fixed assets monthly depreciation" })
  @Post("assets/depreciate")
  @Permissions("finance.journal.create")
  async depreciateAssets(
    @Req() req: AuthenticatedRequest,
    @ZodBody(z.any()) dto: any,
  ) {
    return this.financeService.depreciateAssets(req.user.tenantId, dto);
  }

  @ApiOperation({ summary: "Update tax filing review status" })
  @Post("tax/update-status")
  @Permissions("finance.settings.write")
  async updateTaxStatus(
    @Req() req: AuthenticatedRequest,
    @ZodBody(z.any()) dto: any,
  ) {
    return this.financeService.updateTaxStatus(req.user.tenantId, dto);
  }

  @ApiOperation({ summary: "Update scenario planning forecast drivers" })
  @Post("budget/update-drivers")
  @Permissions("finance.settings.write")
  async updateBudgetDrivers(
    @Req() req: AuthenticatedRequest,
    @ZodBody(z.any()) dto: any,
  ) {
    return this.financeService.updateBudgetDrivers(req.user.tenantId, dto);
  }

  @ApiOperation({ summary: "Get Multi-Currency FX revaluation summary and exposure analysis" })
  @Get("fx-revaluation/summary")
  @Permissions("finance.read")
  async getFxRevaluationSummary(@Req() req: AuthenticatedRequest) {
    return this.financeService.getFxRevaluationSummary(req.user.tenantId);
  }

  @ApiOperation({ summary: "Execute Multi-Currency FX revaluation and post auto-reversing GL journals" })
  @Post("fx-revaluation/run")
  @Permissions("finance.period_close")
  async runFxRevaluation(
    @Req() req: AuthenticatedRequest,
    @ZodBody(z.any()) dto: any,
  ) {
    return this.financeService.runFxRevaluation(req.user.tenantId, dto);
  }

  @ApiOperation({ summary: "Get Intercompany bilateral matrix, elimination rules, and status" })
  @Get("intercompany/summary")
  @Permissions("finance.read")
  async getIntercompanySummary(@Req() req: AuthenticatedRequest) {
    return this.financeService.getIntercompanySummary(req.user.tenantId);
  }

  @ApiOperation({ summary: "Run automated bilateral intercompany balance eliminations" })
  @Post("intercompany/eliminate")
  @Permissions("finance.consolidation.write")
  async runIntercompanyEliminations(
    @Req() req: AuthenticatedRequest,
    @ZodBody(z.any()) dto: any,
  ) {
    return this.financeService.runIntercompanyEliminations(req.user.tenantId, dto);
  }

  @ApiOperation({ summary: "Get Vendor 1099-NEC / 1099-MISC statutory compliance report" })
  @Get("tax/1099-summary")
  @Permissions("finance.read")
  async get1099ReportSummary(@Req() req: AuthenticatedRequest) {
    return this.financeService.get1099ReportSummary(req.user.tenantId);
  }

  @ApiOperation({ summary: "Reset finance interactive state" })
  @Post("demo/reset")
  @Permissions("finance.settings.write")
  async resetFinanceDemoData(@Req() req: AuthenticatedRequest) {
    return this.financeService.resetFinanceDemoData(req.user.tenantId);
  }

  @ApiOperation({ summary: "Get invoice stats" })
  @Get("invoices/stats")
  @Permissions("finance.invoice.read")
  async getInvoiceStats(@Req() req: AuthenticatedRequest) {
    return this.financeService.getInvoiceStats(req.user.tenantId);
  }

  @ApiOperation({ summary: "Get invoice by id" })
  @Get("invoices/:id")
  @Permissions("finance.invoice.read")
  async getInvoiceById(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
  ) {
    return this.financeService.getInvoiceById(req.user.tenantId, id);
  }

  @ApiOperation({ summary: "Create invoice" })
  @Post("invoices")
  @Permissions("finance.invoice.create")
  @UseInterceptors(ChangeHistoryInterceptor)
  @TrackChanges("Invoice")
  async createInvoice(
    @Req() req: AuthenticatedRequest,
    @ZodBody(createInvoiceSchema) dto: CreateInvoiceInput,
  ) {
    const orgId = await resolveOrgId(req.user.tenantId, req.user.orgId);
    return this.financeService.createInvoice(
      req.user.tenantId,
      orgId,
      dto,
      req.user.userId || "system",
    );
  }

  @ApiOperation({ summary: "Update invoice" })
  @Patch("invoices/:id")
  @Permissions("finance.invoice.update")
  @UseInterceptors(ChangeHistoryInterceptor)
  @TrackChanges("Invoice", "id")
  async updateInvoice(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @ZodBody(updateInvoiceSchema) dto: UpdateInvoiceInput,
  ) {
    return this.financeService.updateInvoice(req.user.tenantId, id, dto);
  }

  @ApiOperation({ summary: "Delete invoice" })
  @Delete("invoices/:id")
  @Permissions("finance.invoice.delete")
  async deleteInvoice(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
  ) {
    return this.financeService.deleteInvoice(req.user.tenantId, id);
  }

  @ApiOperation({ summary: "Send invoice" })
  @Post("invoices/:id/send")
  @Permissions("finance.invoice.update")
  async sendInvoice(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    return this.financeService.sendInvoice(req.user.tenantId, id);
  }

  @ApiOperation({ summary: "Void invoice" })
  @Post("invoices/:id/void")
  @Permissions("finance.invoice.update")
  async voidInvoice(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    return this.financeService.voidInvoice(req.user.tenantId, id);
  }

  @ApiOperation({ summary: "Bulk action" })
  @Post("invoices/bulk")
  @Permissions("finance.invoice.update")
  async bulkAction(
    @Req() req: AuthenticatedRequest,
    @ZodBody(bulkActionSchema) dto: BulkActionInput,
  ) {
    return this.financeService.bulkAction(
      req.user.tenantId,
      dto.action,
      dto.ids,
      dto.data,
    );
  }

  // ─── Payment Endpoints ──────────────────────────────

  @ApiOperation({ summary: "Create payment" })
  @Post("payments")
  @Permissions("finance.payment.create")
  @UseInterceptors(ChangeHistoryInterceptor)
  @TrackChanges("Payment")
  async createPayment(
    @Req() req: AuthenticatedRequest,
    @ZodBody(createPaymentSchema) dto: CreatePaymentInput,
  ) {
    return this.financeService.createPayment(
      req.user.tenantId,
      dto,
      req.user.userId || "system",
    );
  }

  @ApiOperation({ summary: "Get payments for an invoice" })
  @Get("invoices/:id/payments")
  @Permissions("finance.payment.read")
  async getPayments(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    return this.financeService.getPayments(req.user.tenantId, id);
  }

  @ApiOperation({ summary: "Get all payments (paginated, filterable)" })
  @Get("payments")
  @Permissions("finance.payment.read")
  async getPaymentsList(
    @Req() req: AuthenticatedRequest,
    @Query("page") page?: string,
    @Query("limit") limit?: string,
    @Query("sort") sort?: string,
    @Query("search") search?: string,
    @Query("invoiceId") invoiceId?: string,
    @Query("customerId") customerId?: string,
  ) {
    return this.financeService.getPaymentsList(req.user.tenantId, {
      page: page ? parseInt(page) : undefined,
      limit: limit ? parseInt(limit) : undefined,
      sort,
      search,
      invoiceId,
      customerId,
    });
  }

  // ─── Chart of Accounts Endpoints ────────────────────

  @ApiOperation({ summary: "Get chart of accounts" })
  @Get("accounts")
  @Permissions("finance.account.read")
  async getAccounts(
    @Req() req: AuthenticatedRequest,
    @Query("page") page?: string,
    @Query("limit") limit?: string,
    @Query("type") type?: string,
    @Query("search") search?: string,
  ) {
    return this.financeService.getAccounts(req.user.tenantId, {
      page: page ? parseInt(page) : undefined,
      limit: limit ? parseInt(limit) : undefined,
      type,
      search,
    });
  }

  @ApiOperation({ summary: "Create general ledger account" })
  @Post("accounts")
  @Permissions("finance.account.create")
  @UseInterceptors(ChangeHistoryInterceptor)
  @TrackChanges("Account")
  async createAccount(
    @Req() req: AuthenticatedRequest,
    @Req() rawReq: any,
  ) {
    const orgId = await resolveOrgId(req.user.tenantId, req.user.orgId);
    return this.financeService.createAccount(req.user.tenantId, orgId, rawReq.body);
  }

  // ─── General Ledger Journal Entries ─────────────────

  @ApiOperation({ summary: "Get journal entries" })
  @Get("journal-entries")
  @Permissions("finance.journal.read")
  async getJournalEntries(
    @Req() req: AuthenticatedRequest,
    @Query("page") page?: string,
    @Query("limit") limit?: string,
    @Query("sort") sort?: string,
  ) {
    return this.financeService.getJournalEntries(req.user.tenantId, {
      page: page ? parseInt(page) : undefined,
      limit: limit ? parseInt(limit) : undefined,
      sort,
    });
  }

  @ApiOperation({ summary: "Post balanced journal entry" })
  @Post("journal-entries")
  @Permissions("finance.journal.create")
  @UseInterceptors(ChangeHistoryInterceptor)
  @TrackChanges("JournalEntry")
  async createJournalEntry(
    @Req() req: AuthenticatedRequest,
    @Req() rawReq: any,
  ) {
    const orgId = await resolveOrgId(req.user.tenantId, req.user.orgId);
    return this.financeService.createJournalEntry(req.user.tenantId, orgId, rawReq.body);
  }

  // ─── Financial Periods ──────────────────────────────

  @ApiOperation({ summary: "Get financial periods" })
  @Get("financial-periods")
  @Permissions("finance.period.read")
  async getFinancialPeriods(@Req() req: AuthenticatedRequest) {
    return this.financeService.getFinancialPeriods(req.user.tenantId);
  }

  @ApiOperation({ summary: "Close financial period" })
  @Post("financial-periods/:id/close")
  @Permissions("finance.period.close")
  async closeFinancialPeriod(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
  ) {
    return this.financeService.closeFinancialPeriod(req.user.tenantId, id);
  }
}

