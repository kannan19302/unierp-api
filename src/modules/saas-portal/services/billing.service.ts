import { PlanHelpers, PaymentHelpers } from "@/common/utils/billing-shared";
import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from "@nestjs/common";
import { prisma } from "@kannan19302/database";
import { idpClient as idpPrisma } from "@/common/idp-client";

/**
 * Plans, pricing, payment methods, transactions, and coupons as consumed
 * from the SaaS Portal home. Consolidates the READ/ADMIN-FACING halves of
 * `modules/saas/plan-engine.{controller,service}.ts`,
 * `modules/saas/payment-methods.{controller,service}.ts`, and
 * `modules/saas/coupons-admin.controller.ts` (backed by `saas.service.ts`
 * coupon methods) into `/saas-portal/billing`.
 *
 * OUT OF SCOPE (per the phase-2 task boundary — do not touch): Stripe/webhook
 * signature verification lives in `modules/saas/billing-webhook.controller.ts`
 * and is neither read, modified, nor duplicated here. `saas.gateway.ts`
 * (realtime) is also untouched.
 *
 * DELEGATE-VS-DUPLICATE: `billing-admin.controller.ts` (analytics/reporting
 * over billing data) and `customer-billing.controller.ts`/
 * `billing-portal.controller.ts` (near-duplicates of payment-methods +
 * invoice-engine aimed at the self-service customer portal) were reviewed and
 * intentionally NOT reproduced in this pass — they are read-only reporting
 * views or near-exact duplicates of the payment-method/invoice surface
 * already consolidated here and in subscription.service.ts, and duplicating
 * them again would triple the same Prisma reads under a third route prefix
 * with no new business logic. The plans/pricing/features + payment-methods +
 * coupons surface below is the actual distinct, reusable business logic.
 * Independent implementation against the same Prisma models, not a
 * cross-module delegate (module-boundary hard-block, no port/event
 * abstraction for this data yet — same rationale as org-hierarchy).
 */
@Injectable()
export class SaasPortalBillingService {
  /* ── Plans ──────────────────────────────────────── */

  async listPlans() { return PlanHelpers.listPlans(); }
  async getPlan(id: string) { return PlanHelpers.getPlan(id); }
  async createPlan(dto: any) { return PlanHelpers.createPlan(dto); }
  async updatePlan(id: string, dto: any) { return PlanHelpers.updatePlan(id, dto); }
  async deletePlan(id: string) { return PlanHelpers.deletePlan(id); }
  async comparePlans(planIds: string[]) { return PlanHelpers.comparePlans(planIds); }
  async getRecommended(tenantId: string) { return PlanHelpers.getRecommended(tenantId); }
  async listPlanPrices(planId: string) { return PlanHelpers.listPlanPrices(planId); }
  async setPlanPrice(planId: string, dto: any) { return PlanHelpers.setPlanPrice(planId, dto); }
  async updatePlanPrice(priceId: string, dto: any) { return PlanHelpers.updatePlanPrice(priceId, dto); }
  async deletePlanPrice(priceId: string) { return PlanHelpers.deletePlanPrice(priceId); }
  async listPlanFeatures(planId: string) { return PlanHelpers.listPlanFeatures(planId); }
  async addPlanFeature(planId: string, dto: any) { return PlanHelpers.addPlanFeature(planId, dto); }
  async updatePlanFeature(featureId: string, dto: any) { return PlanHelpers.updatePlanFeature(featureId, dto); }
  async removePlanFeature(featureId: string) { return PlanHelpers.removePlanFeature(featureId); }

  /* ── Payment Methods ────────────────────────────── */

  async listPaymentMethods(tenantId: string) { return PaymentHelpers.listPaymentMethods(tenantId); }
  async addPaymentMethod(tenantId: string, dto: any) { return PaymentHelpers.addPaymentMethod(tenantId, dto); }
  async setDefaultPaymentMethod(tenantId: string, id: string) { return PaymentHelpers.setDefaultPaymentMethod(tenantId, id); }
  async removePaymentMethod(tenantId: string, id: string) { return PaymentHelpers.removePaymentMethod(tenantId, id); }
  async listTransactions(tenantId: string) { return PaymentHelpers.listTransactions(tenantId); }
  async getTransaction(tenantId: string, id: string) { return PaymentHelpers.getTransaction(tenantId, id); }
  async requestRefund(tenantId: string, transactionId: string, body: any) { return PaymentHelpers.requestRefund(tenantId, transactionId, body); }
  async getPaymentStats(tenantId: string) { return PaymentHelpers.getPaymentStats(tenantId); }

  /* ── Coupons ────────────────────────────────────── */

  async listCoupons() {
    return prisma.saaSCoupon.findMany({ orderBy: { createdAt: "desc" } });
  }

  async getCoupon(id: string) {
    const coupon = await prisma.saaSCoupon.findUnique({ where: { id } });
    if (!coupon) throw new NotFoundException("Coupon not found");
    return coupon;
  }

  async createCoupon(dto: {
    code: string;
    description?: string;
    discountType: string;
    discountValue: number;
    maxRedemptions?: number;
    expiresAt?: string;
  }) {
    const existing = await prisma.saaSCoupon
      .findUnique({ where: { code: dto.code } })
      .catch(() => null);
    if (existing) throw new ConflictException("Coupon code already exists");
    return prisma.saaSCoupon.create({
      data: {
        code: dto.code,
        discountType: dto.discountType,
        discountValue: dto.discountValue,
      },
    });
  }

  async updateCoupon(
    id: string,
    dto: {
      code?: string;
      description?: string;
      discountType?: string;
      discountValue?: number;
      maxRedemptions?: number;
      expiresAt?: string;
    },
  ) {
    const coupon = await prisma.saaSCoupon.findUnique({ where: { id } });
    if (!coupon) throw new NotFoundException("Coupon not found");
    // Whitelist only the client-updatable fields — never spread an
    // unvalidated body directly; status/timesRedeemed etc. are never
    // client-settable here.
    const data: Record<string, unknown> = {};
    if (dto.code !== undefined) data.code = dto.code;
    if (dto.discountType !== undefined) data.discountType = dto.discountType;
    if (dto.discountValue !== undefined) data.discountValue = dto.discountValue;
    if (dto.maxRedemptions !== undefined)
      data.maxRedemptions = dto.maxRedemptions;
    if (dto.expiresAt !== undefined) data.expiresAt = new Date(dto.expiresAt);
    return prisma.saaSCoupon.update({ where: { id }, data });
  }

  async deleteCoupon(id: string) {
    const coupon = await prisma.saaSCoupon.findUnique({ where: { id } });
    if (!coupon) throw new NotFoundException("Coupon not found");
    return prisma.saaSCoupon.delete({ where: { id } });
  }

  async setCouponStatus(id: string, status: "ACTIVE" | "DISABLED") {
    const coupon = await prisma.saaSCoupon.findUnique({ where: { id } });
    if (!coupon) throw new NotFoundException("Coupon not found");
    return prisma.saaSCoupon.update({ where: { id }, data: { status } });
  }

  async getCouponStats() {
    const coupons = await this.listCoupons();
    const total = coupons.length;
    const totalRedeemed = coupons.reduce(
      (s, c: any) => s + (c.timesRedeemed || 0),
      0,
    );
    return {
      total,
      activeCount: coupons.filter((c: any) => c.status !== "DISABLED").length,
      totalRedeemed,
    };
  }

  async bulkCreateCoupons(dto: {
    codes: string[];
    discountType: string;
    discountValue: number;
  }) {
    const results: any[] = [];
    for (const code of dto.codes) {
      try {
        const c = await this.createCoupon({
          code,
          discountType: dto.discountType,
          discountValue: dto.discountValue,
        });
        results.push(c);
      } catch {
        results.push({ code, error: "duplicate" });
      }
    }
    return {
      created: results.filter((r) => !r.error).length,
      duplicates: results.filter((r) => r.error).length,
      results,
    };
  }
}
