import { SubscriptionHelpers, InvoiceHelpers } from "@/modules/saas/shared/billing-shared";
import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import { prisma } from "@kannan19302/database";
import { idpClient as idpPrisma } from "@/common/idp-client";

/**
 * Subscription lifecycle + invoices as consumed from the SaaS Portal home.
 * Consolidates the read/admin-facing halves of
 * `modules/saas/subscription-lifecycle.controller.ts`,
 * `modules/saas/invoice-engine.{controller,service}.ts`, and
 * `modules/admin/subscription.{controller,service}.ts` (platform-admin plan
 * assignment / seat management) into `/saas-portal/subscription`.
 *
 * OUT OF SCOPE: Stripe/webhook signature verification
 * (`modules/saas/billing-webhook.controller.ts`) and the realtime gateway
 * (`modules/saas/saas.gateway.ts`) are untouched. `saas/customer-billing` and
 * `saas/billing-portal` controllers largely re-expose the same
 * invoice/payment surface for the self-service customer portal and were not
 * duplicated a third time (see services/billing.service.ts header for the
 * full delegate-vs-duplicate rationale).
 *
 * Independent implementation against the same `TenantSubscription`/
 * `SaaSInvoice`/`BillingEvent` Prisma models, not a cross-module delegate —
 * module-boundary hard-block, no port/event abstraction for this data yet.
 */
@Injectable()
export class SaasPortalSubscriptionService {
  /* ── Subscription ───────────────────────────────── */

  async getCurrentSubscription(tenantId: string) { return SubscriptionHelpers.getCurrentSubscription(tenantId); }
  async getCurrentPlan(tenantId: string) { return SubscriptionHelpers.getCurrentPlan(tenantId); }
  async getAvailablePlans() { return SubscriptionHelpers.getAvailablePlans(); }
  async changePlan(tenantId: string, planId: string) { return SubscriptionHelpers.changePlan(tenantId, planId); }
  async updateSeats(tenantId: string, seats: number) { return SubscriptionHelpers.updateSeats(tenantId, seats); }
  async cancelSubscription(tenantId: string) { return SubscriptionHelpers.cancelSubscription(tenantId); }
  async getBillingHistory(tenantId: string, page = 1, limit = 20) { return SubscriptionHelpers.getBillingHistory(tenantId, page, limit); }
  async getTrialInfo(tenantId: string) { return SubscriptionHelpers.getTrialInfo(tenantId); }
  async validateSubscriptionAccess(tenantId: string) { return SubscriptionHelpers.validateSubscriptionAccess(tenantId); }

  /* ── Invoices ───────────────────────────────────── */

  async listInvoices(tenantId: string, page: number, limit: number, status?: string) { return InvoiceHelpers.listInvoices(tenantId, page, limit, status); }
  async getInvoice(tenantId: string, id: string) { return InvoiceHelpers.getInvoice(tenantId, id); }
  async generateInvoiceNumber() { return InvoiceHelpers.generateInvoiceNumber(); }
  async generateInvoice(tenantId: string, body: any) { return InvoiceHelpers.generateInvoice(tenantId, body); }
  async payInvoice(tenantId: string, id: string) { return InvoiceHelpers.payInvoice(tenantId, id); }
  async refundInvoice(tenantId: string, id: string) { return InvoiceHelpers.refundInvoice(tenantId, id); }
  async cancelInvoice(tenantId: string, id: string) { return InvoiceHelpers.cancelInvoice(tenantId, id); }
  async downloadInvoicePdf(tenantId: string, id: string) { return InvoiceHelpers.downloadInvoicePdf(tenantId, id); }
  async getInvoiceStats(tenantId: string) { return InvoiceHelpers.getInvoiceStats(tenantId); }
  async getUpcomingInvoices(tenantId: string) { return InvoiceHelpers.getUpcomingInvoices(tenantId); }
}
