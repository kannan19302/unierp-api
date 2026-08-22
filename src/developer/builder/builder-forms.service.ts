import {
  Injectable,
  Optional,
  BadRequestException,
  NotFoundException,
} from "@nestjs/common";
import { prisma } from "@kannan19302/database";
import { idpClient as idpPrisma } from "@/common/idp-client";
import { ArtifactRegistryService } from "../platform/artifact-registry.service";
import { ArtifactRevisionsService } from "../platform/artifact-revisions.service";
import type {
  CreateBuilderFormInput,
  UpdateBuilderFormInput,
} from "@kannan19302/shared";

// Some historical rows have `fields` double-encoded (a JSON string stored
// inside the Json column instead of the array itself) — normalise on the way
// out so API consumers always see a real array regardless of how it was written.
function normalizeFields<T extends { fields?: unknown }>(form: T): T {
  if (typeof form.fields === "string") {
    try {
      return { ...form, fields: JSON.parse(form.fields) };
    } catch {
      return { ...form, fields: [] };
    }
  }
  return form;
}

@Injectable()
export class BuilderFormsService {
  constructor(@Optional() private readonly artifacts?: ArtifactRegistryService, @Optional() private readonly revisions?: ArtifactRevisionsService) {}

  private async mirrorCanonicalForm(tenantId: string, form: any) {
    const artifact = await this.artifacts?.record({ tenantId, artifactType: "FORM", artifactId: form.id, name: form.name, slug: form.slug, status: form.status, icon: form.icon });
    if (!artifact || !this.revisions) return;
    const fields = Array.isArray(form.fields) ? form.fields : [];
    const submitTargetArtifactId = typeof form.settings?.submitTargetArtifactId === "string" && form.settings.submitTargetArtifactId ? form.settings.submitTargetArtifactId : undefined;
    const submit = submitTargetArtifactId ? { action: "CREATE_RECORD", targetArtifactId: submitTargetArtifactId, fieldMap: form.settings?.submitFieldMap && typeof form.settings.submitFieldMap === "object" ? form.settings.submitFieldMap : {} } : form.settings?.submitAction ? { action: String(form.settings.submitAction) } : undefined;
    const pages = Array.isArray(form.pages) && form.pages.length ? form.pages.map((page: any) => ({ id: String(page.id ?? page.title ?? "page"), title: page.title, fields: (Array.isArray(page.fieldIds) ? page.fieldIds.map((id: string) => fields.find((field: any) => field.id === id)).filter(Boolean) : fields).map((field: any) => ({ id: String(field.id ?? field.name), name: String(field.name ?? field.id), type: String(field.type ?? "string"), label: String(field.label ?? field.name ?? field.id), required: Boolean(field.required), configuration: field })) })) : [{ id: "default", fields: fields.map((field: any) => ({ id: String(field.id ?? field.name), name: String(field.name ?? field.id), type: String(field.type ?? "string"), label: String(field.label ?? field.name ?? field.id), required: Boolean(field.required), configuration: field })) }];
    await this.revisions.syncLegacyProjection({ tenantId, artifactId: artifact.id, scope: { kind: "LIBRARY" }, createdBy: form.createdBy ?? null, source: {
      apiVersion: "unierp.dev/v1", kind: "FORM", metadata: { id: artifact.id, namespace: `tenant.${tenantId}`, name: form.name, description: form.description ?? undefined },
      spec: { title: form.name, pages, submit },
      interfaces: { inputs: [], outputs: [], events: [] }, dependencies: submitTargetArtifactId ? [{ targetArtifactId: submitTargetArtifactId }] : [], capabilities: submitTargetArtifactId ? ["data.write"] : [], tests: [],
      extensions: { legacyProjection: { table: "builder_forms", id: form.id, slug: form.slug, conditions: form.conditions ?? [], settings: form.settings ?? {} } },
    } });
  }
  async getForms(
    tenantId: string,
    params: {
      page?: number;
      limit?: number;
      search?: string;
      module?: string;
    } = {},
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
    if (params.module && params.module !== "All Modules") {
      where.module = { equals: params.module, mode: "insensitive" };
    }
    const [data, total] = await Promise.all([
      prisma.builderForm.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
      }),
      prisma.builderForm.count({ where }),
    ]);

    // Fetch schema registries to associate count
    const schemas =
      (await prisma.schemaRegistry.findMany({
        where: { tenantId },
        select: {
          id: true,
          slug: true,
          _count: {
            select: { customRecords: true },
          },
        },
      })) || [];
    const schemaMap = new Map(
      schemas.map((s) => [s.slug, s._count.customRecords]),
    );

    const formsWithSubmissions = data.map((form) => {
      const submissions = schemaMap.get(form.slug) || 0;
      return {
        ...normalizeFields(form),
        submissions,
      };
    });

    return {
      data: formsWithSubmissions,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  async getFormStats(tenantId: string) {
    const [total, published, draft] = await Promise.all([
      prisma.builderForm.count({ where: { tenantId } }),
      prisma.builderForm.count({
        where: { tenantId, status: { in: ["PUBLISHED", "Published"] } },
      }),
      prisma.builderForm.count({
        where: { tenantId, status: { in: ["DRAFT", "Draft"] } },
      }),
    ]);

    const schemas =
      (await prisma.schemaRegistry.findMany({
        where: { tenantId },
        select: {
          id: true,
          slug: true,
          _count: {
            select: { customRecords: true },
          },
        },
      })) || [];

    const builderFormSlugs =
      (await prisma.builderForm.findMany({
        where: { tenantId },
        select: { slug: true },
      })) || [];
    const slugSet = new Set(builderFormSlugs.map((f) => f.slug));

    let totalSubmissions = 0;
    for (const schema of schemas) {
      if (slugSet.has(schema.slug)) {
        totalSubmissions += schema._count.customRecords;
      }
    }

    return {
      total,
      published,
      draft,
      totalSubmissions,
    };
  }

  async getFormById(tenantId: string, id: string) {
    const form = await prisma.builderForm.findFirst({
      where: { id, tenantId },
    });
    if (!form) throw new NotFoundException("Form not found");
    return normalizeFields(form);
  }

  async createForm(tenantId: string, dto: CreateBuilderFormInput) {
    const existing = await prisma.builderForm.findFirst({
      where: { tenantId, slug: dto.slug },
    });
    if (existing)
      throw new BadRequestException("A form with this slug already exists");

    const created = await prisma.builderForm.create({
      data: {
        tenantId,
        name: dto.name,
        slug: dto.slug,
        description: dto.description || null,
        icon: dto.icon || null,
        module: dto.module || "Sales",
        fields: (dto.fields || []) as any,
        // The deployed form contract already supports these G10 fields; the
        // shared DTO is intentionally backwards compatible and is catching
        // up separately, so preserve them without rejecting legacy callers.
        pages: ((dto as any).pages || []) as any,
        conditions: ((dto as any).conditions || []) as any,
        settings: (dto.settings || {}) as any,
      },
    });
    await this.mirrorCanonicalForm(tenantId, created);
    return created;
  }

  async updateForm(tenantId: string, id: string, dto: UpdateBuilderFormInput) {
    const form = await prisma.builderForm.findFirst({
      where: { id, tenantId },
    });
    if (!form) throw new NotFoundException("Form not found");

    const updated = await prisma.builderForm.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.icon !== undefined && { icon: dto.icon }),
        ...(dto.module !== undefined && { module: dto.module }),
        ...(dto.status !== undefined && { status: dto.status }),
        ...(dto.fields !== undefined && { fields: dto.fields as any }),
        ...((dto as any).pages !== undefined && { pages: (dto as any).pages as any }),
        ...((dto as any).conditions !== undefined && { conditions: (dto as any).conditions as any }),
        ...(dto.settings !== undefined && { settings: dto.settings as any }),
      },
    });
    await this.mirrorCanonicalForm(tenantId, updated);
    return updated;
  }

  async deleteForm(tenantId: string, id: string) {
    const form = await prisma.builderForm.findFirst({
      where: { id, tenantId },
    });
    if (!form) throw new NotFoundException("Form not found");
    const deleted = await prisma.builderForm.delete({ where: { id } });
    await this.artifacts?.retire(tenantId, "FORM", id);
    return deleted;
  }

  async publishBuilderForm(tenantId: string, id: string) {
    const form = await prisma.builderForm.findFirst({
      where: { id, tenantId },
    });
    if (!form) throw new NotFoundException("Form not found");

    let schema = await prisma.schemaRegistry.findFirst({
      where: { tenantId, slug: form.slug },
    });
    if (!schema) {
      schema = await prisma.schemaRegistry.create({
        data: {
          tenantId,
          module: form.module || "custom",
          name: form.name,
          slug: form.slug,
          description: form.description,
          fields: form.fields || [],
          settings: form.settings || {},
          status: "ACTIVE",
        },
      });
    } else {
      schema = await prisma.schemaRegistry.update({
        where: { id: schema.id },
        data: {
          module: form.module || "custom",
          fields: form.fields || [],
          settings: form.settings || {},
        },
      });
    }

    const layout = {
      fields: form.fields || [],
      pages: form.pages || [],
      conditions: form.conditions || [],
      settings: form.settings || {},
    };

    let page = await prisma.pageRegistry.findFirst({
      where: { tenantId, slug: form.slug },
    });
    if (!page) {
      page = await prisma.pageRegistry.create({
        data: {
          tenantId,
          schemaId: schema.id,
          module: form.module || "custom",
          slug: form.slug,
          title: form.name,
          type: "FORM",
          layout,
          status: "PUBLISHED",
        },
      });
    } else {
      page = await prisma.pageRegistry.update({
        where: { id: page.id },
        data: {
          schemaId: schema.id,
          module: form.module || "custom",
          layout,
          status: "PUBLISHED",
        },
      });
    }

    await prisma.builderForm.update({
      where: { id },
      data: { status: "PUBLISHED" },
    });

    return { form, schema, page };
  }
}
