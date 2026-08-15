import { NotFoundException, ConflictException, BadRequestException } from "@nestjs/common";
import { prisma } from "@kannan19302/database";
import { idpClient as idpPrisma } from "@/common/idp-client";

export class SubscriptionHelpers {
  static async getCurrentSubscription(tenantId: string) {
    const subscription = await prisma.tenantSubscription.findUnique({
      where: { tenantId },
      include: {
        plan: { include: { prices: { where: { isActive: true } } } },
        addOns: { include: { addon: true } },
      },
    });
    if (!subscription) return null;
    return subscription;
  }

  static async getCurrentPlan(tenantId: string) {
    const subscription = await prisma.tenantSubscription.findUnique({
      where: { tenantId },
      include: { plan: true },
    });
    const userCount = await idpPrisma.user.count({
      where: { tenantId, status: "ACTIVE" },
    });

    if (!subscription) {
      return {
        plan: {
          name: "Free",
          maxUsers: 5,
          maxStorage: 1024,
          price: 0,
          interval: "monthly",
        },
        usage: {
          users: userCount,
          maxUsers: 5,
          storageUsed: 0,
          maxStorage: 1024,
        },
        status: "ACTIVE",
      };
    }

    return {
      plan: subscription.plan || {
        name: "Free",
        maxUsers: 5,
        maxStorage: 1024,
        price: 0,
        interval: "monthly",
      },
      usage: {
        users: userCount,
        maxUsers: subscription.plan?.maxUsers || 5,
        storageUsed: 0,
        maxStorage: subscription.plan?.maxStorage || 1024,
      },
      status: subscription.status,
      currentPeriodEnd: subscription.endDate,
    };
  }

  static async getAvailablePlans() {
    return prisma.saaSPlan.findMany({ orderBy: { maxUsers: "asc" } });
  }

  static async changePlan(tenantId: string, planId: string) {
    const plan = await prisma.saaSPlan.findUnique({ where: { id: planId } });
    if (!plan) throw new NotFoundException("Plan not found");

    const subscription = await prisma.tenantSubscription.update({
      where: { tenantId },
      data: { planId },
      include: { plan: true },
    });

    await prisma.billingEvent.create({
      data: {
        tenantId,
        type: "PLAN_CHANGE",
        amount: 0,
        description: `Plan changed to ${plan.name}`,
        metadata: { planId, planName: plan.name },
      },
    });

    return subscription;
  }

  static async updateSeats(tenantId: string, seats: number) {
    const subscription = await prisma.tenantSubscription.findUnique({
      where: { tenantId },
      include: { plan: true },
    });
    if (!subscription)
      throw new NotFoundException("No active subscription found");

    await prisma.billingEvent.create({
      data: {
        tenantId,
        type: "SEAT_UPDATE",
        amount: 0,
        description: `Seats updated to ${seats}`,
        metadata: { seats, planId: subscription.planId },
      },
    });

    return { seats, subscription };
  }

  static async cancelSubscription(tenantId: string) {
    const subscription = await prisma.tenantSubscription.findUnique({
      where: { tenantId },
    });
    if (!subscription)
      throw new NotFoundException("No active subscription found");

    const updated = await prisma.tenantSubscription.update({
      where: { tenantId },
      data: { status: "CANCELLED" },
    });
    await prisma.billingEvent.create({
      data: {
        tenantId,
        type: "CANCELLATION",
        amount: 0,
        description: "Subscription cancelled",
      },
    });
    return updated;
  }

  static async getBillingHistory(tenantId: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [events, total] = await Promise.all([
      prisma.billingEvent.findMany({
        where: { tenantId },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      prisma.billingEvent.count({ where: { tenantId } }),
    ]);
    return {
      data: events,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  static async getTrialInfo(tenantId: string) {
    const sub = await prisma.tenantSubscription.findUnique({
      where: { tenantId },
    });
    return {
      isTrial: sub?.status === "TRIAL",
      trialEndsAt: (sub as any)?.trialEndsAt ?? null,
      daysRemaining: (sub as any)?.trialEndsAt
        ? Math.max(
            0,
            Math.ceil(
              (new Date((sub as any).trialEndsAt).getTime() - Date.now()) /
                86400000,
            ),
          )
        : 0,
    };
  }

  static async validateSubscriptionAccess(tenantId: string) {
    const sub = await prisma.tenantSubscription.findUnique({
      where: { tenantId },
    });
    return {
      valid: sub?.status === "ACTIVE" || sub?.status === "TRIAL",
      subscription: sub,
    };
  }
}

export class InvoiceHelpers {
  static async listInvoices(
    tenantId: string,
    page: number,
    limit: number,
    status?: string,
  ) {
    const where: Record<string, unknown> = { tenantId };
    if (status) where.status = status;

    const [items, total] = await Promise.all([
      prisma.saaSInvoice.findMany({
        where: where as any,
        include: { lines: true },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.saaSInvoice.count({ where: where as any }),
    ]);
    return { items, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  static async getInvoice(tenantId: string, id: string) {
    const invoice = await prisma.saaSInvoice.findFirst({
      where: { id, tenantId },
      include: { lines: true, transactions: true },
    });
    if (!invoice) throw new NotFoundException("Invoice not found");
    return invoice;
  }

  static async generateInvoiceNumber() {
    const now = new Date();
    const prefix = `INV-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}-`;
    const last = await prisma.saaSInvoice.findFirst({
      where: { invoiceNumber: { startsWith: prefix } },
      orderBy: { invoiceNumber: "desc" },
      select: { invoiceNumber: true },
    });
    let seq = 1;
    if (last) {
      const parts = last.invoiceNumber.split("-");
      const lastPart = parts[parts.length - 1];
      seq = lastPart ? parseInt(lastPart, 10) + 1 : 1;
    }
    return `${prefix}${String(seq).padStart(5, "0")}`;
  }

  static async generateInvoice(
    tenantId: string,
    body: {
      planId: string;
      amount: number;
      currency?: string;
      description?: string;
      dueDate?: string;
    },
  ) {
    const invoiceNumber = await InvoiceHelpers.generateInvoiceNumber();
    const totalAmount = body.amount;

    return prisma.saaSInvoice.create({
      data: {
        tenantId,
        invoiceNumber,
        status: "DRAFT",
        currency: body.currency ?? "USD",
        subtotal: totalAmount,
        totalAmount,
        amountDue: totalAmount,
        dueDate: body.dueDate
          ? new Date(body.dueDate)
          : new Date(Date.now() + 15 * 24 * 60 * 60 * 1000),
        lines: {
          create: [
            {
              description: body.description ?? "Service",
              type: "PLAN",
              quantity: 1,
              unitPrice: totalAmount,
              totalPrice: totalAmount,
            },
          ],
        },
      },
      include: { lines: true },
    });
  }

  static async payInvoice(tenantId: string, id: string) {
    const invoice = await prisma.saaSInvoice.findFirst({
      where: { id, tenantId },
    });
    if (!invoice) throw new NotFoundException("Invoice not found");
    if (invoice.status === "PAID")
      throw new BadRequestException("Invoice already paid");
    if (invoice.status === "CANCELLED")
      throw new BadRequestException("Invoice is cancelled");

    return prisma.$transaction([
      prisma.saaSInvoice.update({
        where: { id },
        data: {
          status: "PAID",
          amountPaid: invoice.totalAmount,
          amountDue: 0,
          paidAt: new Date(),
        },
      }),
      prisma.paymentTransaction.create({
        data: {
          tenantId,
          invoiceId: id,
          provider: "MANUAL",
          type: "SUBSCRIPTION",
          status: "SUCCEEDED",
          amount: invoice.totalAmount,
          currency: invoice.currency,
          description: `Payment for invoice ${invoice.invoiceNumber}`,
        },
      }),
    ]);
  }

  static async refundInvoice(tenantId: string, id: string) {
    const invoice = await prisma.saaSInvoice.findFirst({
      where: { id, tenantId },
    });
    if (!invoice) throw new NotFoundException("Invoice not found");
    if (invoice.status !== "PAID")
      throw new BadRequestException("Only paid invoices can be refunded");

    return prisma.$transaction([
      prisma.saaSInvoice.update({
        where: { id },
        data: { status: "REFUNDED", amountPaid: 0, amountDue: 0 },
      }),
      prisma.paymentTransaction.create({
        data: {
          tenantId,
          invoiceId: id,
          provider: "MANUAL",
          type: "REFUND",
          status: "SUCCEEDED",
          amount: invoice.totalAmount,
          currency: invoice.currency,
          description: `Refund for invoice ${invoice.invoiceNumber}`,
        },
      }),
    ]);
  }

  static async cancelInvoice(tenantId: string, id: string) {
    const invoice = await prisma.saaSInvoice.findFirst({
      where: { id, tenantId },
    });
    if (!invoice) throw new NotFoundException("Invoice not found");
    if (invoice.status !== "DRAFT")
      throw new BadRequestException("Only draft invoices can be cancelled");
    return prisma.saaSInvoice.update({
      where: { id },
      data: { status: "CANCELLED" },
    });
  }

  static async downloadInvoicePdf(tenantId: string, id: string) {
    const invoice = await prisma.saaSInvoice.findFirst({
      where: { id, tenantId },
    });
    if (!invoice) throw new NotFoundException("Invoice not found");
    return {
      pdfUrl: invoice.pdfUrl || null,
      invoiceNumber: invoice.invoiceNumber,
    };
  }

  static async getInvoiceStats(tenantId: string) {
    const invoices = await prisma.saaSInvoice.findMany({
      where: { tenantId },
      select: {
        status: true,
        totalAmount: true,
        amountPaid: true,
        amountDue: true,
      },
    });
    return {
      totalInvoices: invoices.length,
      paidCount: invoices.filter((i) => i.status === "PAID").length,
      pendingCount: invoices.filter((i) => i.status === "PENDING").length,
      overdueCount: invoices.filter((i) => i.status === "OVERDUE").length,
      draftCount: invoices.filter((i) => i.status === "DRAFT").length,
      cancelledCount: invoices.filter((i) => i.status === "CANCELLED").length,
      refundedCount: invoices.filter((i) => i.status === "REFUNDED").length,
      totalPaid: invoices
        .filter((i) => i.status === "PAID")
        .reduce((s, i) => s + Number(i.totalAmount), 0),
      totalOutstanding: invoices
        .filter((i) => i.status === "PENDING" || i.status === "OVERDUE")
        .reduce((s, i) => s + Number(i.amountDue), 0),
    };
  }

  static async getUpcomingInvoices(tenantId: string) {
    const sub = await prisma.tenantSubscription.findFirst({
      where: { tenantId, status: { in: ["ACTIVE", "TRIAL"] } },
      include: {
        plan: { include: { prices: { where: { isActive: true } } } },
        addOns: { include: { addon: true } },
      },
    });
    if (!sub) return null;

    const usdPrice = (sub.plan as any).prices?.[0]
      ? Number((sub.plan as any).prices[0].monthly)
      : 0;
    const planCost = sub.billingPeriod === "YEARLY" ? usdPrice * 12 : usdPrice;
    let total = planCost;

    const lineItems: Array<{
      description: string;
      type: string;
      amount: number;
    }> = [
      { description: `Plan: ${sub.plan.name}`, type: "PLAN", amount: planCost },
    ];
    for (const tao of sub.addOns) {
      const cost = Number(tao.addon.price) * tao.quantity;
      total += cost;
      lineItems.push({
        description: `Add-On: ${tao.addon.name} x${tao.quantity}`,
        type: "ADDON",
        amount: cost,
      });
    }

    return {
      nextBillingDate: sub.endDate,
      billingPeriod: sub.billingPeriod,
      currency: sub.currency,
      estimatedTotal: total,
      lineItems,
    };
  }
}

export class PlanHelpers {
  static async listPlans() {
    return prisma.saaSPlan.findMany({
      where: { status: { not: "ARCHIVED" } },
      orderBy: { sortOrder: "asc" },
      include: {
        prices: { where: { isActive: true } },
        featureEntitlements: { where: { isActive: true } },
      },
    });
  }

  static async getPlan(id: string) {
    const plan = await prisma.saaSPlan.findUnique({
      where: { id },
      include: {
        prices: { where: { isActive: true } },
        featureEntitlements: { where: { isActive: true } },
        quotaRules: true,
      },
    });
    if (!plan) throw new NotFoundException("Plan not found");
    return plan;
  }

  static async createPlan(dto: {
    name: string;
    description?: string;
    price: number;
    currency?: string;
    interval?: string;
    maxUsers: number;
    maxStorage: number;
    maxApiCalls?: number;
    isActive?: boolean;
    sortOrder?: number;
    stripePriceId?: string;
  }) {
    const stripePriceId =
      dto.stripePriceId ??
      `${dto.name.toLowerCase().replace(/\s+/g, "-")}_${Date.now()}`;
    const existing = await prisma.saaSPlan.findUnique({
      where: { stripePriceId },
    });
    if (existing)
      throw new ConflictException(
        "Plan with this Stripe price ID already exists",
      );

    return prisma.saaSPlan.create({
      data: {
        name: dto.name,
        stripePriceId,
        maxUsers: dto.maxUsers,
        maxStorage: dto.maxStorage,
        maxApiCalls: dto.maxApiCalls ?? 10000,
        features: [],
        description: dto.description,
        isPublic: dto.isActive ?? true,
        sortOrder: dto.sortOrder ?? 0,
        prices: {
          create: {
            currency: dto.currency ?? "USD",
            region: "US",
            monthly:
              dto.interval === "year" ? Math.round(dto.price / 12) : dto.price,
            yearly: dto.interval === "year" ? dto.price : dto.price * 12,
          },
        },
      },
      include: { prices: true, featureEntitlements: true },
    });
  }

  static async updatePlan(
    id: string,
    dto: {
      name?: string;
      description?: string;
      maxUsers?: number;
      maxStorage?: number;
      maxApiCalls?: number;
      isActive?: boolean;
      sortOrder?: number;
    },
  ) {
    const plan = await prisma.saaSPlan.findUnique({ where: { id } });
    if (!plan) throw new NotFoundException("Plan not found");

    return prisma.saaSPlan.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.maxUsers !== undefined && { maxUsers: dto.maxUsers }),
        ...(dto.maxStorage !== undefined && { maxStorage: dto.maxStorage }),
        ...(dto.maxApiCalls !== undefined && { maxApiCalls: dto.maxApiCalls }),
        ...(dto.isActive !== undefined && { isPublic: dto.isActive }),
        ...(dto.sortOrder !== undefined && { sortOrder: dto.sortOrder }),
      },
      include: { prices: true, featureEntitlements: true },
    });
  }

  static async deletePlan(id: string) {
    const plan = await prisma.saaSPlan.findUnique({ where: { id } });
    if (!plan) throw new NotFoundException("Plan not found");
    return prisma.saaSPlan.update({
      where: { id },
      data: { status: "ARCHIVED" },
    });
  }

  static async comparePlans(planIds: string[]) {
    const plans = await prisma.saaSPlan.findMany({
      where: { id: { in: planIds }, status: { not: "ARCHIVED" } },
      include: {
        prices: { where: { isActive: true } },
        featureEntitlements: { where: { isActive: true } },
      },
      orderBy: { sortOrder: "asc" },
    });
    return plans.map((plan) => ({
      id: plan.id,
      name: plan.name,
      description: plan.description,
      maxUsers: plan.maxUsers,
      maxStorage: plan.maxStorage,
      maxApiCalls: plan.maxApiCalls,
      prices: plan.prices,
      features: plan.featureEntitlements,
    }));
  }

  static async getRecommended(tenantId: string) {
    const usage = await prisma.usageRecord.findMany({ where: { tenantId } });
    const userCount = await idpPrisma.user.count({ where: { tenantId } });
    const usageMap = new Map(usage.map((r) => [r.metric, r.currentValue]));
    const currentUsers = usageMap.get("USERS_COUNT") ?? userCount;
    const currentStorage = usageMap.get("STORAGE_MB") ?? 0;
    const currentApi = usageMap.get("API_CALLS_COUNT") ?? 0;

    const plans = await prisma.saaSPlan.findMany({
      where: { status: "ACTIVE", isPublic: true },
      orderBy: { sortOrder: "asc" },
      include: {
        prices: { where: { isActive: true, currency: "USD", region: "US" } },
        featureEntitlements: { where: { isActive: true } },
      },
    });

    const scored = plans.map((plan) => {
      let score = 0;
      if (currentUsers <= plan.maxUsers) score += 30;
      else score -= (currentUsers - plan.maxUsers) * 5;
      if (currentStorage <= plan.maxStorage) score += 30;
      else score -= (currentStorage - plan.maxStorage) / 100;
      if (currentApi <= plan.maxApiCalls) score += 20;
      else score -= (currentApi - plan.maxApiCalls) / 1000;
      if (plan.featureEntitlements.length > 0) score += 10;
      return { plan, score };
    });
    scored.sort((a, b) => b.score - a.score);
    return scored[0] ? scored[0].plan : null;
  }

  /* ── Plan Prices ────────────────────────────────── */

  static async listPlanPrices(planId: string) {
    const plan = await prisma.saaSPlan.findUnique({ where: { id: planId } });
    if (!plan) throw new NotFoundException("Plan not found");
    return prisma.saaSPlanPrice.findMany({ where: { planId, isActive: true } });
  }

  static async setPlanPrice(
    planId: string,
    dto: {
      amount: number;
      currency: string;
      interval: string;
      isActive?: boolean;
    },
  ) {
    const plan = await prisma.saaSPlan.findUnique({ where: { id: planId } });
    if (!plan) throw new NotFoundException("Plan not found");

    const region = "US";
    const existing = await prisma.saaSPlanPrice.findUnique({
      where: {
        planId_currency_region: { planId, currency: dto.currency, region },
      },
    });
    if (existing)
      throw new ConflictException(
        "Price already exists for this plan/currency/region",
      );

    return prisma.saaSPlanPrice.create({
      data: {
        planId,
        currency: dto.currency,
        region,
        monthly:
          dto.interval === "year" ? Math.round(dto.amount / 12) : dto.amount,
        yearly: dto.interval === "year" ? dto.amount : dto.amount * 12,
        isActive: dto.isActive ?? true,
      },
    });
  }

  static async updatePlanPrice(
    priceId: string,
    dto: {
      amount?: number;
      currency?: string;
      interval?: string;
      isActive?: boolean;
    },
  ) {
    const price = await prisma.saaSPlanPrice.findUnique({
      where: { id: priceId },
    });
    if (!price) throw new NotFoundException("Plan price not found");

    const updateData: Record<string, unknown> = {};
    if (dto.amount !== undefined) {
      updateData.monthly =
        dto.interval === "year" ? Math.round(dto.amount / 12) : dto.amount;
      updateData.yearly =
        dto.interval === "year" ? dto.amount : dto.amount * 12;
    }
    if (dto.currency !== undefined) updateData.currency = dto.currency;
    if (dto.isActive !== undefined) updateData.isActive = dto.isActive;

    return prisma.saaSPlanPrice.update({
      where: { id: priceId },
      data: updateData,
    });
  }

  static async deletePlanPrice(priceId: string) {
    const price = await prisma.saaSPlanPrice.findUnique({
      where: { id: priceId },
    });
    if (!price) throw new NotFoundException("Plan price not found");
    return prisma.saaSPlanPrice.delete({ where: { id: priceId } });
  }

  /* ── Plan Features ──────────────────────────────── */

  static async listPlanFeatures(planId: string) {
    const plan = await prisma.saaSPlan.findUnique({ where: { id: planId } });
    if (!plan) throw new NotFoundException("Plan not found");
    return prisma.saaSPlanFeature.findMany({
      where: { planId, isActive: true },
    });
  }

  static async addPlanFeature(
    planId: string,
    dto: {
      featureKey: string;
      featureName: string;
      featureType?: string;
      featureValue?: string;
      description?: string;
    },
  ) {
    const plan = await prisma.saaSPlan.findUnique({ where: { id: planId } });
    if (!plan) throw new NotFoundException("Plan not found");

    const typeMap: Record<string, string> = {
      boolean: "BOOLEAN",
      numeric: "USAGE_LIMITED",
      text: "BOOLEAN",
      select: "BOOLEAN",
    };
    const existing = await prisma.saaSPlanFeature.findUnique({
      where: { planId_featureKey: { planId, featureKey: dto.featureKey } },
    });
    if (existing)
      throw new ConflictException("Feature already exists for this plan");

    return prisma.saaSPlanFeature.create({
      data: {
        planId,
        featureKey: dto.featureKey,
        name: dto.featureName,
        description: dto.description,
        type: typeMap[dto.featureType ?? "boolean"] ?? "BOOLEAN",
        limitValue: dto.featureValue
          ? parseInt(dto.featureValue, 10) || null
          : null,
      },
    });
  }

  static async updatePlanFeature(
    featureId: string,
    dto: {
      featureName?: string;
      featureType?: string;
      featureValue?: string;
      description?: string;
    },
  ) {
    const feature = await prisma.saaSPlanFeature.findUnique({
      where: { id: featureId },
    });
    if (!feature) throw new NotFoundException("Plan feature not found");

    const typeMap: Record<string, string> = {
      boolean: "BOOLEAN",
      numeric: "USAGE_LIMITED",
      text: "BOOLEAN",
      select: "BOOLEAN",
    };
    const updateData: Record<string, unknown> = {};
    if (dto.featureName !== undefined) updateData.name = dto.featureName;
    if (dto.description !== undefined) updateData.description = dto.description;
    if (dto.featureType !== undefined)
      updateData.type = typeMap[dto.featureType] ?? "BOOLEAN";
    if (dto.featureValue !== undefined)
      updateData.limitValue = parseInt(dto.featureValue, 10) || null;

    return prisma.saaSPlanFeature.update({
      where: { id: featureId },
      data: updateData,
    });
  }

  static async removePlanFeature(featureId: string) {
    const feature = await prisma.saaSPlanFeature.findUnique({
      where: { id: featureId },
    });
    if (!feature) throw new NotFoundException("Plan feature not found");
    return prisma.saaSPlanFeature.delete({ where: { id: featureId } });
  }
}

export class PaymentHelpers {
  static async listPaymentMethods(tenantId: string) {
    return prisma.paymentMethod.findMany({
      where: { tenantId },
      orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
    });
  }

  static async addPaymentMethod(
    tenantId: string,
    dto: {
      type: string;
      token: string;
      isDefault: boolean;
      cardLast4?: string;
      cardBrand?: string;
    },
  ) {
    if (dto.isDefault) {
      await prisma.paymentMethod.updateMany({
        where: { tenantId, isDefault: true },
        data: { isDefault: false },
      });
    }
    return prisma.paymentMethod.create({
      data: {
        tenantId,
        provider: dto.type === "card" ? "STRIPE" : dto.type.toUpperCase(),
        providerPaymentMethodId: dto.token,
        cardBrand: dto.cardBrand,
        cardLast4: dto.cardLast4,
        isDefault: dto.isDefault,
      },
    });
  }

  static async setDefaultPaymentMethod(tenantId: string, id: string) {
    const pm = await prisma.paymentMethod.findFirst({
      where: { id, tenantId },
    });
    if (!pm) throw new NotFoundException("Payment method not found");
    await prisma.paymentMethod.updateMany({
      where: { tenantId, isDefault: true },
      data: { isDefault: false },
    });
    return prisma.paymentMethod.update({
      where: { id },
      data: { isDefault: true },
    });
  }

  static async removePaymentMethod(tenantId: string, id: string) {
    const pm = await prisma.paymentMethod.findFirst({
      where: { id, tenantId },
    });
    if (!pm) throw new NotFoundException("Payment method not found");
    return prisma.paymentMethod.delete({ where: { id } });
  }

  /* ── Transactions ───────────────────────────────── */

  static async listTransactions(tenantId: string) {
    return prisma.paymentTransaction.findMany({
      where: { tenantId },
      include: { invoice: true, paymentMethod: true },
      orderBy: { createdAt: "desc" },
    });
  }

  static async getTransaction(tenantId: string, id: string) {
    const tx = await prisma.paymentTransaction.findFirst({
      where: { id, tenantId },
      include: { invoice: { include: { lines: true } }, paymentMethod: true },
    });
    if (!tx) throw new NotFoundException("Transaction not found");
    return tx;
  }

  static async requestRefund(
    tenantId: string,
    transactionId: string,
    body: { amount?: number; reason?: string },
  ) {
    const tx = await prisma.paymentTransaction.findFirst({
      where: { id: transactionId, tenantId },
    });
    if (!tx) throw new NotFoundException("Transaction not found");
    if (tx.status !== "SUCCEEDED")
      throw new BadRequestException(
        "Only successful transactions can be refunded",
      );

    return prisma.$transaction([
      prisma.paymentTransaction.update({
        where: { id: transactionId },
        data: { status: "REFUNDED" },
      }),
      prisma.paymentTransaction.create({
        data: {
          tenantId,
          invoiceId: tx.invoiceId,
          provider: tx.provider,
          type: "REFUND",
          status: "SUCCEEDED",
          amount: body.amount ?? tx.amount,
          currency: tx.currency,
          description: body.reason ?? `Refund of transaction ${transactionId}`,
        },
      }),
    ]);
  }

  static async getPaymentStats(tenantId: string) {
    const transactions = await prisma.paymentTransaction.findMany({
      where: { tenantId },
      select: { status: true, amount: true, type: true },
    });
    const succeededCount = transactions.filter(
      (t) => t.status === "SUCCEEDED",
    ).length;
    const totalSucceeded = transactions
      .filter((t) => t.status === "SUCCEEDED")
      .reduce((s, t) => s + Number(t.amount), 0);

    return {
      totalTransactions: transactions.length,
      succeededCount,
      failedCount: transactions.filter((t) => t.status === "FAILED").length,
      pendingCount: transactions.filter((t) => t.status === "PENDING").length,
      refundedCount: transactions.filter((t) => t.status === "REFUNDED").length,
      totalSucceeded,
      totalFailed: transactions
        .filter((t) => t.status === "FAILED")
        .reduce((s, t) => s + Number(t.amount), 0),
      successRate:
        transactions.length > 0
          ? Math.round((succeededCount / transactions.length) * 100)
          : 0,
    };
  }
}

