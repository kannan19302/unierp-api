import {
  Injectable,
  Optional,
  BadRequestException,
  NotFoundException,
} from "@nestjs/common";
import { prisma } from "@kannan19302/database";
import { idpClient as idpPrisma } from "@/common/idp-client";
import { ArtifactRegistryService } from "../../platform/artifact-registry.service";
import { ArtifactRevisionsService } from "../../platform/artifact-revisions.service";

@Injectable()
export class BuilderAdvancedFormsService {
  constructor(@Optional() private readonly artifacts?: ArtifactRegistryService, @Optional() private readonly revisions?: ArtifactRevisionsService) {}

  private async mirrorCanonicalForm(tenantId: string, form: any) {
    const artifact = await this.artifacts?.record({ tenantId, artifactType: "ADVANCED_FORM", artifactId: form.id, name: form.name, slug: form.slug, status: form.status });
    if (!artifact || !this.revisions) return;
    const fields = Array.isArray(form.fields) ? form.fields : [];
    const pages = Array.isArray(form.pages) && form.pages.length ? form.pages.map((page: any) => ({ id: String(page.id ?? page.title ?? "page"), title: page.title, fields: (Array.isArray(page.fieldIds) ? page.fieldIds.map((id: string) => fields.find((field: any) => field.id === id)).filter(Boolean) : fields).map((field: any) => ({ id: String(field.id ?? field.name), name: String(field.name ?? field.id), type: String(field.type ?? field.fieldType ?? "string"), label: String(field.label ?? field.name ?? field.id), required: Boolean(field.required), configuration: field })) })) : [{ id: "default", fields: fields.map((field: any) => ({ id: String(field.id ?? field.name), name: String(field.name ?? field.id), type: String(field.type ?? field.fieldType ?? "string"), label: String(field.label ?? field.name ?? field.id), required: Boolean(field.required), configuration: field })) }];
    await this.revisions.syncLegacyProjection({ tenantId, artifactId: artifact.id, scope: { kind: "LIBRARY" }, source: { apiVersion: "unierp.dev/v1", kind: "ADVANCED_FORM", metadata: { id: artifact.id, namespace: `tenant.${tenantId}`, name: form.name, description: form.description ?? undefined }, spec: { title: form.name, pages }, interfaces: { inputs: [], outputs: [], events: [] }, dependencies: [], capabilities: [], tests: [], extensions: { legacyProjection: { table: "advanced_forms", id: form.id, formType: form.formType, conditions: form.conditions ?? [], calculatedFields: form.calculatedFields ?? [], settings: form.settings ?? {} } } } });
  }
  async getAdvancedForms(
    tenantId: string,
    params: { page?: number; limit?: number; search?: string } = {},
  ) {
    const page = params.page || 1;
    const limit = params.limit || 50;
    const skip = (page - 1) * limit;
    const where: any = { tenantId };
    if (params.search) {
      where.OR = [
        { name: { contains: params.search, mode: "insensitive" } },
        { slug: { contains: params.search, mode: "insensitive" } },
      ];
    }
    const [data, total] = await Promise.all([
      prisma.advancedForm.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
      }),
      prisma.advancedForm.count({ where }),
    ]);
    return {
      data,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  async getAdvancedFormById(tenantId: string, id: string) {
    const form = await prisma.advancedForm.findFirst({
      where: { id, tenantId },
    });
    if (!form) throw new NotFoundException("Advanced form not found");
    return form;
  }

  async createConditionalForm(tenantId: string, dto: any) {
    const existing = await prisma.advancedForm.findFirst({
      where: { tenantId, slug: dto.slug },
    });
    if (existing)
      throw new BadRequestException(
        "An advanced form with this slug already exists",
      );

    const created = await prisma.advancedForm.create({
      data: {
        tenantId,
        name: dto.name,
        slug: dto.slug,
        description: dto.description || null,
        formType: dto.formType || "STANDARD",
        fields: dto.fields || [],
        conditions: dto.conditions || [],
        calculatedFields: [],
        pages: dto.pages || [],
        settings: dto.settings || {},
      },
    });
    await this.mirrorCanonicalForm(tenantId, created);
    return created;
  }

  async updateAdvancedForm(tenantId: string, id: string, dto: any) {
    const form = await prisma.advancedForm.findFirst({
      where: { id, tenantId },
    });
    if (!form) throw new NotFoundException("Advanced form not found");

    const updated = await prisma.advancedForm.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.status !== undefined && { status: dto.status }),
        ...(dto.fields !== undefined && { fields: dto.fields as any }),
        ...(dto.conditions !== undefined && {
          conditions: dto.conditions as any,
        }),
        ...(dto.calculatedFields !== undefined && {
          calculatedFields: dto.calculatedFields as any,
        }),
        ...(dto.pages !== undefined && { pages: dto.pages as any }),
        ...(dto.settings !== undefined && { settings: dto.settings as any }),
      },
    });
    await this.mirrorCanonicalForm(tenantId, updated);
    return updated;
  }

  async deleteAdvancedForm(tenantId: string, id: string) {
    const form = await prisma.advancedForm.findFirst({
      where: { id, tenantId },
    });
    if (!form) throw new NotFoundException("Advanced form not found");
    const deleted = await prisma.advancedForm.delete({ where: { id } });
    await this.artifacts?.retire(tenantId, "ADVANCED_FORM", id);
    return deleted;
  }

  async addCalculatedField(tenantId: string, formId: string, dto: any) {
    const form = await prisma.advancedForm.findFirst({
      where: { id: formId, tenantId },
    });
    if (!form) throw new NotFoundException("Advanced form not found");

    const calculatedFields = [
      ...((form.calculatedFields as any[]) || []),
      {
        id: `calc_${Date.now()}`,
        name: dto.name,
        label: dto.label || dto.name,
        formula: dto.formula,
        fieldType: dto.fieldType || "number",
        order: (form.calculatedFields as any[])?.length || 0,
      },
    ];

    const updated = await prisma.advancedForm.update({
      where: { id: formId },
      data: { calculatedFields: calculatedFields as any },
    });
    await this.mirrorCanonicalForm(tenantId, updated);
    return updated;
  }

  async addFormPage(tenantId: string, formId: string, dto: any) {
    const form = await prisma.advancedForm.findFirst({
      where: { id: formId, tenantId },
    });
    if (!form) throw new NotFoundException("Advanced form not found");

    const pages = [
      ...((form.pages as any[]) || []),
      {
        id: `page_${Date.now()}`,
        title: dto.title,
        order: (form.pages as any[])?.length || 0,
        fieldIds: dto.fieldIds || [],
        settings: dto.settings || {},
      },
    ];

    const updated = await prisma.advancedForm.update({
      where: { id: formId },
      data: { pages: pages as any, formType: "MULTI_PAGE" },
    });
    await this.mirrorCanonicalForm(tenantId, updated);
    return updated;
  }

  async getFormAnalytics(tenantId: string, formId: string) {
    const form = await prisma.advancedForm.findFirst({
      where: { id: formId, tenantId },
    });
    if (!form) throw new NotFoundException("Advanced form not found");

    const analytics = await prisma.formAnalytics.findMany({
      where: { tenantId, formId },
      orderBy: { updatedAt: "desc" },
    });
    return analytics;
  }

  async createFormVersion(tenantId: string, formId: string, dto: any) {
    const form = await prisma.advancedForm.findFirst({
      where: { id: formId, tenantId },
    });
    if (!form) throw new NotFoundException("Advanced form not found");

    const newVersion = (form.version || 0) + 1;

    await prisma.formVersion.create({
      data: {
        tenantId,
        formId,
        version: form.version || 1,
        fields: form.fields as any,
        settings: form.settings as any,
        conditions: form.conditions as any,
        pages: form.pages as any,
        changelog: dto.changelog || null,
        createdBy: dto.createdBy || null,
      },
    });

    return prisma.advancedForm.update({
      where: { id: formId },
      data: { version: newVersion },
    });
  }

  async getFormVersions(tenantId: string, formId: string) {
    return prisma.formVersion.findMany({
      where: { tenantId, formId },
      orderBy: { version: "desc" },
    });
  }

  async previewForm(tenantId: string, formId: string) {
    const form = await prisma.advancedForm.findFirst({
      where: { id: formId, tenantId },
    });
    if (!form) throw new NotFoundException("Advanced form not found");
    return form;
  }
}
