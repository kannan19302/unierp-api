import { PaymentHelpers } from "@/common/utils/billing-shared";
import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import { prisma } from "@kannan19302/database";
import { idpClient as idpPrisma } from "@/common/idp-client";

@Injectable()
export class PaymentMethodsService {
  public get db(): typeof prisma {
    return prisma;
  }
  async listPaymentMethods(tenantId: string) { return PaymentHelpers.listPaymentMethods(tenantId); }
  async addPaymentMethod(tenantId: string, dto: any) { return PaymentHelpers.addPaymentMethod(tenantId, dto); }
  async setDefault(tenantId: string, id: string) { return PaymentHelpers.setDefaultPaymentMethod(tenantId, id); }
  async removePaymentMethod(tenantId: string, id: string) { return PaymentHelpers.removePaymentMethod(tenantId, id); }
  async listTransactions(tenantId: string) { return PaymentHelpers.listTransactions(tenantId); }
  async getTransaction(tenantId: string, id: string) { return PaymentHelpers.getTransaction(tenantId, id); }
  async requestRefund(tenantId: string, transactionId: string, body: any) { return PaymentHelpers.requestRefund(tenantId, transactionId, body); }
  async getPaymentStats(tenantId: string) { return PaymentHelpers.getPaymentStats(tenantId); }
}
