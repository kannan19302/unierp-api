import { Injectable, NotFoundException } from "@nestjs/common";
import { prisma } from "@kannan19302/database";
import { idpClient as idpPrisma } from "@/common/idp-client";
import { DocumentTemplateEngineService } from "./document-template-engine.service";

@Injectable()
export class SalesDocumentsDeepService {
  constructor(private readonly templateEngine: DocumentTemplateEngineService) {}

  async getTemplates(tenantId: string, category?: string) {
    const where: any = { tenantId, isActive: true };
    if (category) where.category = category;

    return prisma.salesDocumentTemplate.findMany({
      where,
      orderBy: { createdAt: "desc" },
    });
  }

  async createTemplate(tenantId: string, dto: any) {
    if (dto.isDefault) {
      await prisma.salesDocumentTemplate.updateMany({
        where: { tenantId, category: dto.category },
        data: { isDefault: false },
      });
    }

    return prisma.salesDocumentTemplate.create({
      data: {
        tenantId,
        name: dto.name,
        category: dto.category || "PROPOSAL",
        content: dto.content,
        variables: dto.variables || null,
        isDefault: dto.isDefault ?? false,
        isActive: dto.isActive ?? true,
      },
    });
  }

  async generateDocument(tenantId: string, dto: any) {
    const template = await prisma.salesDocumentTemplate.findFirst({
      where: { id: dto.templateId, tenantId },
    });
    if (!template) throw new NotFoundException("Template not found");

    // Invoices are actually rendered from the template's own content against
    // the real Invoice row — this is the E29 mechanism, not a caller-supplied
    // URL. Every other category still accepts a caller-supplied documentUrl
    // (e.g. an externally-generated proposal/MSA) — invoice rendering is
    // what E29's exit criterion names explicitly.
    let documentUrl = dto.documentUrl || null;
    if (template.category === "INVOICE" && dto.invoiceId) {
      const pdf = await this.templateEngine.renderInvoicePdf(tenantId, dto.templateId, dto.invoiceId);
      documentUrl = `data:application/pdf;base64,${pdf.toString("base64")}`;
    }

    return prisma.salesDocumentGeneration.create({
      data: {
        tenantId,
        templateId: dto.templateId,
        customerId: dto.customerId || null,
        opportunityId: dto.opportunityId || null,
        title:
          dto.title ||
          `${template.name} - ${new Date().toISOString().slice(0, 10)}`,
        status: "DRAFT",
        documentUrl,
        metadata: dto.invoiceId ? { ...(dto.metadata || {}), invoiceId: dto.invoiceId } : dto.metadata || null,
        generatedBy: dto.generatedBy || null,
      },
      include: { template: true },
    });
  }

  async editTemplateContent(tenantId: string, templateId: string, content: string) {
    return this.templateEngine.editTemplateContent(tenantId, templateId, content);
  }

  async getGenerations(tenantId: string, customerId?: string) {
    const where: any = { tenantId };
    if (customerId) where.customerId = customerId;

    return prisma.salesDocumentGeneration.findMany({
      where,
      include: { template: true },
      orderBy: { createdAt: "desc" },
    });
  }

  async updateGenerationStatus(tenantId: string, id: string, status: string) {
    const gen = await prisma.salesDocumentGeneration.findFirst({
      where: { id, tenantId },
    });
    if (!gen) throw new NotFoundException("Generated document not found");

    const data: any = { status };
    if (status === "SENT") data.sentAt = new Date();
    if (status === "SIGNED") data.signedAt = new Date();

    return prisma.salesDocumentGeneration.update({
      where: { id },
      data,
    });
  }
}
