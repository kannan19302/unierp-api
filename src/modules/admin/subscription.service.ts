import { SubscriptionHelpers } from "@/modules/saas/shared/billing-shared";
import { Injectable } from "@nestjs/common";
import { prisma } from "@kannan19302/database";
import { idpClient as idpPrisma } from "@/common/idp-client";

@Injectable()
export class SubscriptionService {
  async getCurrentPlan(tenantId: string) { return SubscriptionHelpers.getCurrentPlan(tenantId); }
  async getAvailablePlans() { return SubscriptionHelpers.getAvailablePlans(); }
  async changePlan(tenantId: string, planId: string) { return SubscriptionHelpers.changePlan(tenantId, planId); }
  async updateSeats(tenantId: string, seats: number) { return SubscriptionHelpers.updateSeats(tenantId, seats); }
  async getBillingHistory(tenantId: string, page = 1, limit = 20) { return SubscriptionHelpers.getBillingHistory(tenantId, page, limit); }
}
