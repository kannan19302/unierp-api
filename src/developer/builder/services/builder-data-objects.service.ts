import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { prisma } from "@kannan19302/database";
import type {
  CreateCustomObjectInput,
  AddCustomObjectFieldInput,
} from "@kannan19302/shared";
import { CustomObjectSchemaService } from "./custom-object-schema.service";

/** Columns the platform supplies on every generated table — never a declarable field name. */
const RESERVED_FIELD_NAMES = new Set([
  "id",
  "tenant_id",
  "created_at",
  "updated_at",
]);

/**
 * Data Object Builder — G09. CRUD over the object/field *definitions*, plus
 * the orchestration that makes "a custom object can never be created without
 * isolation" true by construction rather than by convention: `create()`
 * writes the CustomObjectDefinition/Field rows and provisions the backing
 * table in the SAME database transaction, so a definition existing without
 * its table (or vice versa) is not a state the database can reach —
 * Postgres DDL is transactional, so a failure on either side rolls back both.
 */
@Injectable()
export class BuilderDataObjectsService {
  constructor(private readonly schemaService: CustomObjectSchemaService) {}

  async list(tenantId: string) {
    return prisma.customObjectDefinition.findMany({
      where: { tenantId },
      include: { fields: true },
      orderBy: { createdAt: "desc" },
    });
  }

  async getById(tenantId: string, id: string) {
    const object = await prisma.customObjectDefinition.findFirst({
      where: { id, tenantId },
      include: { fields: true },
    });
    if (!object) throw new NotFoundException("Custom object not found");
    return object;
  }

  async create(
    tenantId: string,
    userId: string | undefined,
    dto: CreateCustomObjectInput,
  ) {
    const existing = await prisma.customObjectDefinition.findFirst({
      where: { tenantId, apiName: dto.apiName },
    });
    if (existing) {
      throw new BadRequestException(
        `A custom object named "${dto.apiName}" already exists`,
      );
    }
    this.validateFields(dto.fields);

    const objectId = randomUUID();
    const tableName = this.schemaService.tableName(objectId);

    return prisma.$transaction(async (tx) => {
      const object = await tx.customObjectDefinition.create({
        data: {
          id: objectId,
          tenantId,
          apiName: dto.apiName,
          label: dto.label,
          description: dto.description,
          tableName,
          createdByUserId: userId,
          fields: {
            create: dto.fields.map((f) => ({
              tenantId,
              name: f.name,
              label: f.label,
              type: f.type,
              required: f.required,
              indexed: f.indexed,
            })),
          },
        },
        include: { fields: true },
      });

      await this.schemaService.provision(tx, objectId, dto.fields);

      return object;
    });
  }

  /**
   * Additive only — an existing field is never altered or dropped here.
   * Mirrors the extension schema's additive-upgrade rule: removing a column
   * would destroy tenant data, so that is a separate, deliberate operation
   * this phase does not build.
   */
  async addField(
    tenantId: string,
    id: string,
    field: AddCustomObjectFieldInput,
  ) {
    const object = await this.getById(tenantId, id);
    if (object.status !== "ACTIVE") {
      throw new BadRequestException(
        `Cannot add a field to an ${object.status.toLowerCase()} custom object`,
      );
    }
    if (object.fields.some((f) => f.name === field.name)) {
      throw new BadRequestException(
        `Field "${field.name}" already exists on this object`,
      );
    }
    if (RESERVED_FIELD_NAMES.has(field.name)) {
      throw new BadRequestException(
        `"${field.name}" is supplied by the platform and cannot be redeclared`,
      );
    }

    return prisma.$transaction(async (tx) => {
      const created = await tx.customObjectFieldDefinition.create({
        data: { tenantId, objectId: id, ...field },
      });
      await this.schemaService.addField(tx, id, field);
      return created;
    });
  }

  /**
   * Deletes the definition only — the data table is left in place, same
   * "reclaiming storage is a separate, deliberate operation" rule as
   * extension uninstall (G03). Archives rather than hard-deletes so a
   * dangling `CustomObjectFieldDefinition` FK never exists mid-request.
   */
  async archive(tenantId: string, id: string) {
    const object = await this.getById(tenantId, id);
    return prisma.customObjectDefinition.update({
      where: { id: object.id },
      data: { status: "ARCHIVED" },
    });
  }

  private validateFields(fields: CreateCustomObjectInput["fields"]) {
    const seen = new Set<string>();
    for (const f of fields) {
      if (RESERVED_FIELD_NAMES.has(f.name)) {
        throw new BadRequestException(
          `"${f.name}" is supplied by the platform and cannot be redeclared`,
        );
      }
      if (seen.has(f.name)) {
        throw new BadRequestException(`Field "${f.name}" declared twice`);
      }
      seen.add(f.name);
    }
  }
}
