import { PlanHelpers } from "@/modules/saas/shared/billing-shared";
import {
  Injectable,
  NotFoundException,
  ConflictException,
} from "@nestjs/common";
import { prisma } from "@kannan19302/database";
import { idpClient as idpPrisma } from "@/common/idp-client";

@Injectable()
export class PlanEngineService {
  public get db(): typeof prisma {
    return prisma;
  }
  async listPlans(_tenantId?: string) { return PlanHelpers.listPlans(); }
  async getPlan(_tenantId: string, id: string) { return PlanHelpers.getPlan(id); }
  async createPlan(_tenantId: string, dto: any) { return PlanHelpers.createPlan(dto); }
  async updatePlan(_tenantId: string, id: string, dto: any) { return PlanHelpers.updatePlan(id, dto); }
  async deletePlan(_tenantId: string, id: string) { return PlanHelpers.deletePlan(id); }
  async comparePlans(_tenantId: string, planIds: string[]) { return PlanHelpers.comparePlans(planIds); }
  async getRecommended(tenantId: string) { return PlanHelpers.getRecommended(tenantId); }
  async listPlanPrices(_tenantId: string, planId: string) { return PlanHelpers.listPlanPrices(planId); }
  async setPlanPrice(_tenantId: string, planId: string, dto: any) { return PlanHelpers.setPlanPrice(planId, dto); }
  async updatePlanPrice(_tenantId: string, priceId: string, dto: any) { return PlanHelpers.updatePlanPrice(priceId, dto); }
  async deletePlanPrice(_tenantId: string, priceId: string) { return PlanHelpers.deletePlanPrice(priceId); }
  async listPlanFeatures(_tenantId: string, planId: string) { return PlanHelpers.listPlanFeatures(planId); }
  async addPlanFeature(_tenantId: string, planId: string, dto: any) { return PlanHelpers.addPlanFeature(planId, dto); }
  async updatePlanFeature(_tenantId: string, featureId: string, dto: any) { return PlanHelpers.updatePlanFeature(featureId, dto); }
  async removePlanFeature(_tenantId: string, featureId: string) { return PlanHelpers.removePlanFeature(featureId); }
}
