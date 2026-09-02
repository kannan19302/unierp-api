import { Injectable, NotFoundException } from "@nestjs/common";
import { prisma } from "@kannan19302/database";
import { idpClient as idpPrisma } from "../../../common/idp-client";

@Injectable()
export class SubscriptionService {
  async getCurrentPlan(tenantId: string) {
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
    };
  }

  async getAvailablePlans() {
    return prisma.saasSubscriptionPlan.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: "asc" },
    });
  }

  async changePlan(tenantId: string, planId: string) {
    const plan = await prisma.saasSubscriptionPlan.findUnique({
      where: { id: planId },
    });
    if (!plan) throw new NotFoundException("Plan not found");

    return prisma.tenantSubscription.upsert({
      where: { tenantId },
      create: {
        tenantId,
        planId,
        status: "ACTIVE",
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 30 * 86400000),
      },
      update: {
        planId,
        status: "ACTIVE",
      },
      include: { plan: true },
    });
  }

  async updateSeats(tenantId: string, seats: number) {
    return prisma.tenantSubscription.update({
      where: { tenantId },
      data: { customSeats: seats },
      include: { plan: true },
    });
  }

  async getBillingHistory(tenantId: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [invoices, total] = await Promise.all([
      prisma.subscriptionInvoice.findMany({
        where: { tenantId },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      prisma.subscriptionInvoice.count({ where: { tenantId } }),
    ]);

    return {
      data: invoices,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }
}
