import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { IDENTIFIER, type FieldType } from "@kannan19302/extension-api";
import { prisma } from "@kannan19302/database";
import { randomUUID } from "node:crypto";

type PlanArtifact = { artifactId: string; kind: string; source: any };

@Injectable()
export class PreviewSubmissionsService {
  private readonly db = prisma as any;

  async submit(input: { tenantId: string; projectId: string; previewId?: string; runtime?: { releaseId: string; environmentId: string }; formArtifactId: string; values: Record<string, unknown>; createdBy?: string | null; artifacts: PlanArtifact[] }) {
    if (!input.previewId && !input.runtime) throw new BadRequestException("Submission execution identity is required");
    const form = input.artifacts.find((artifact) => artifact.artifactId === input.formArtifactId && artifact.kind === "FORM");
    if (!form) throw new NotFoundException("Form artifact is not part of this preview composition");
    const binding = form.source?.spec?.submit;
    if (!binding?.targetArtifactId || typeof binding.targetArtifactId !== "string") throw new BadRequestException("Form has no typed Data Object submission binding");
    const target = input.artifacts.find((artifact) => artifact.artifactId === binding.targetArtifactId && artifact.kind === "DATA_OBJECT");
    if (!target) throw new BadRequestException("Bound Data Object is not part of this preview composition");
    const objectDefinitionId = target.source?.spec?.objectDefinitionId;
    if (typeof objectDefinitionId !== "string") throw new BadRequestException("Bound Data Object has no generated-table definition");

    const object = await this.db.customObjectDefinition.findFirst({ where: { id: objectDefinitionId, tenantId: input.tenantId, status: "ACTIVE" }, include: { fields: true } });
    if (!object) throw new NotFoundException("Active tenant Data Object definition not found");
    if (!IDENTIFIER.test(object.tableName)) throw new BadRequestException("Data Object storage identifier is invalid");

    const formFields = new Set((form.source?.spec?.pages ?? []).flatMap((page: any) => Array.isArray(page?.fields) ? page.fields : []).map((field: any) => String(field?.id ?? field?.name ?? "")).filter(Boolean));
    const fieldMap = binding.fieldMap && typeof binding.fieldMap === "object" ? binding.fieldMap as Record<string, string> : {};
    const mapped: Record<string, unknown> = {};
    for (const [formField, raw] of Object.entries(input.values)) {
      if (!formFields.has(formField)) throw new BadRequestException(`Field "${formField}" is not declared by the Form`);
      const targetField = fieldMap[formField] ?? formField;
      if (Object.hasOwn(mapped, targetField)) throw new BadRequestException(`Multiple Form fields map to "${targetField}"`);
      mapped[targetField] = raw;
    }

    const definitions = new Map<string, any>(object.fields.map((field: any) => [field.name, field]));
    for (const name of Object.keys(mapped)) if (!definitions.has(name)) throw new BadRequestException(`Field "${name}" is not declared by the Data Object`);
    for (const field of object.fields) if (field.required && (mapped[field.name] === undefined || mapped[field.name] === null || mapped[field.name] === "")) throw new BadRequestException(`Field "${field.name}" is required`);

    const entries = Object.entries(mapped).map(([name, value]) => {
      const field = definitions.get(name);
      if (!IDENTIFIER.test(name)) throw new BadRequestException("Data Object field identifier is invalid");
      return { name, value: this.coerce(field.type as FieldType, value, name) };
    });
    const columns = ["id", "tenant_id", ...entries.map((entry) => entry.name)];
    const values = [Prisma.sql`${randomUUID()}`, Prisma.sql`${input.tenantId}`, ...entries.map((entry) => entry.value)];
    const [record] = await this.db.$queryRaw(Prisma.sql`INSERT INTO ${Prisma.raw(`"${object.tableName}"`)} (${Prisma.join(columns.map((name) => Prisma.raw(`"${name}"`)))}) VALUES (${Prisma.join(values)}) RETURNING "id", "created_at"`);
    await this.audit(input, target.artifactId, record.id);
    return { id: record.id, createdAt: record.created_at, projectId: input.projectId, formArtifactId: form.artifactId, dataObjectArtifactId: target.artifactId };
  }

  private coerce(type: FieldType, value: unknown, name: string): Prisma.Sql {
    if (value === null || value === undefined || value === "") return Prisma.sql`${null}`;
    if (type === "string" || type === "text") {
      if (typeof value !== "string") throw new BadRequestException(`Field "${name}" must be text`);
      return Prisma.sql`${value}`;
    }
    if (type === "int") {
      const parsed = typeof value === "number" ? value : typeof value === "string" && /^-?\d+$/.test(value) ? Number(value) : Number.NaN;
      if (!Number.isSafeInteger(parsed)) throw new BadRequestException(`Field "${name}" must be an integer`);
      return Prisma.sql`${parsed}`;
    }
    if (type === "decimal") {
      const decimal = typeof value === "number" ? String(value) : typeof value === "string" ? value : "";
      if (!/^-?\d{1,15}(\.\d{1,4})?$/.test(decimal)) throw new BadRequestException(`Field "${name}" must be a decimal with at most four fractional digits`);
      return Prisma.sql`${decimal}::decimal`;
    }
    if (type === "boolean") {
      const parsed = value === true || value === "true" ? true : value === false || value === "false" ? false : null;
      if (parsed === null) throw new BadRequestException(`Field "${name}" must be a boolean`);
      return Prisma.sql`${parsed}`;
    }
    if (type === "datetime") {
      const parsed = value instanceof Date ? value : typeof value === "string" ? new Date(value) : new Date(Number.NaN);
      if (Number.isNaN(parsed.getTime())) throw new BadRequestException(`Field "${name}" must be a valid datetime`);
      return Prisma.sql`${parsed}`;
    }
    if (type === "json") return Prisma.sql`${JSON.stringify(value)}::jsonb`;
    throw new BadRequestException(`Field "${name}" has an unsupported type`);
  }

  private async audit(input: { tenantId: string; projectId: string; previewId?: string; runtime?: { releaseId: string; environmentId: string }; createdBy?: string | null }, dataObjectArtifactId: string, recordId: string) {
    const metadata = input.previewId ? { previewId: input.previewId, dataObjectArtifactId, recordId } : { releaseId: input.runtime!.releaseId, environmentId: input.runtime!.environmentId, dataObjectArtifactId, recordId };
    try { await this.db.developerAuditEvent?.create({ data: { tenantId: input.tenantId, projectId: input.projectId, action: input.previewId ? "PREVIEW_RECORD_CREATED" : "RUNTIME_RECORD_CREATED", actorId: input.createdBy ?? null, metadata } }); } catch { /* the committed tenant record remains authoritative */ }
  }
}
