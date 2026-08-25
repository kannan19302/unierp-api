import {
  Injectable,
  BadRequestException,
  NotFoundException,
  Logger,
} from "@nestjs/common";
import { prisma } from "@kannan19302/database";
import {
  ExecuteMasterDataImportInput,
  MasterDataEntityType,
} from "@kannan19302/shared";

export interface ValidationResult {
  totalRows: number;
  validRows: number;
  errorRows: number;
  errors: Array<{ row: number; field: string; message: string }>;
  samplePreview: Record<string, any>[];
}

@Injectable()
export class MasterDataImportService {
  private readonly logger = new Logger(MasterDataImportService.name);

  /**
   * Validates and previews uploaded data rows against entity field requirements.
   */
  async validateRows(
    tenantId: string,
    entityType: MasterDataEntityType,
    rows: Record<string, any>[],
    fieldMappings: Record<string, string>,
  ): Promise<ValidationResult> {
    const errors: Array<{ row: number; field: string; message: string }> = [];
    const mappedRows: Record<string, any>[] = [];

    rows.forEach((rawRow, index) => {
      const rowIndex = index + 1;
      const mappedRow: Record<string, any> = {};

      for (const [csvKey, erpField] of Object.entries(fieldMappings)) {
        if (erpField && rawRow[csvKey] !== undefined) {
          mappedRow[erpField] = rawRow[csvKey];
        }
      }

      // Entity-specific validation rules
      switch (entityType) {
        case "CUSTOMER":
        case "VENDOR":
          if (!mappedRow.name || String(mappedRow.name).trim().length === 0) {
            errors.push({
              row: rowIndex,
              field: "name",
              message: "Company / Contact name is required",
            });
          }
          if (
            mappedRow.email &&
            !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(mappedRow.email))
          ) {
            errors.push({
              row: rowIndex,
              field: "email",
              message: `Invalid email format: ${mappedRow.email}`,
            });
          }
          break;

        case "ITEM":
          if (!mappedRow.name || String(mappedRow.name).trim().length === 0) {
            errors.push({
              row: rowIndex,
              field: "name",
              message: "Item name is required",
            });
          }
          if (mappedRow.price !== undefined && mappedRow.price !== null) {
            const priceNum = Number(mappedRow.price);
            if (isNaN(priceNum) || priceNum < 0) {
              errors.push({
                row: rowIndex,
                field: "price",
                message: "Price must be a positive decimal number",
              });
            }
          }
          break;

        case "GL_ACCOUNT":
          if (!mappedRow.code || String(mappedRow.code).trim().length === 0) {
            errors.push({
              row: rowIndex,
              field: "code",
              message: "Account Code is required",
            });
          }
          if (!mappedRow.name || String(mappedRow.name).trim().length === 0) {
            errors.push({
              row: rowIndex,
              field: "name",
              message: "Account Name is required",
            });
          }
          break;

        case "OPENING_BALANCE":
          if (
            !mappedRow.accountCode ||
            String(mappedRow.accountCode).trim().length === 0
          ) {
            errors.push({
              row: rowIndex,
              field: "accountCode",
              message: "Account Code is required",
            });
          }
          break;

        default:
          break;
      }

      mappedRows.push(mappedRow);
    });

    const errorRowCount = new Set(errors.map((e) => e.row)).size;
    const validRows = Math.max(0, rows.length - errorRowCount);

    return {
      totalRows: rows.length,
      validRows,
      errorRows: errorRowCount,
      errors: errors.slice(0, 100), // Return first 100 errors for display
      samplePreview: mappedRows.slice(0, 5),
    };
  }

  /**
   * Executes transactional master data import.
   */
  async executeImport(
    tenantId: string,
    userId: string,
    input: ExecuteMasterDataImportInput,
  ) {
    const { entityType, fileName, fieldMappings, rows, dryRun } = input;

    // Validate rows first
    const validation = await this.validateRows(
      tenantId,
      entityType,
      rows,
      fieldMappings,
    );

    if (dryRun) {
      return {
        isDryRun: true,
        validation,
        message: "Dry run validation completed successfully",
      };
    }

    if (validation.validRows === 0 && rows.length > 0) {
      throw new BadRequestException(
        "Cannot execute import: all provided rows failed validation.",
      );
    }

    const targetOrganization = await prisma.organization.findFirst({
      where: { tenantId },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    if (
      ["CUSTOMER", "VENDOR", "ITEM"].includes(entityType) &&
      !targetOrganization
    ) {
      throw new BadRequestException(
        "Create an organization before importing customers, vendors, or items.",
      );
    }

    // Create Job Record
    const job = await prisma.masterDataImportJob.create({
      data: {
        tenantId,
        entityType,
        fileName,
        fileSize: JSON.stringify(rows).length,
        totalRows: rows.length,
        processedRows: 0,
        successRows: 0,
        errorRows: validation.errorRows,
        errorDetails: validation.errors as any,
        fieldMappings: fieldMappings as any,
        status: "IMPORTING",
        startedAt: new Date(),
        createdBy: userId,
      },
    });

    try {
      let importedCount = 0;
      const CHUNK_SIZE = 100;

      // Group rows into chunks
      for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
        const chunk = rows.slice(i, i + CHUNK_SIZE);

        await prisma.$transaction(async (tx) => {
          // Set tenant session for RLS
          await tx.$executeRaw`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;

          for (const rawRow of chunk) {
            const mappedRow: Record<string, any> = {};
            for (const [csvKey, erpField] of Object.entries(fieldMappings)) {
              if (erpField && rawRow[csvKey] !== undefined) {
                mappedRow[erpField] = rawRow[csvKey];
              }
            }

            if (entityType === "CUSTOMER" && mappedRow.name) {
              await tx.customer.create({
                data: {
                  tenantId,
                  orgId: targetOrganization!.id,
                  name: String(mappedRow.name).trim(),
                  email: mappedRow.email ? String(mappedRow.email).trim() : null,
                  phone: mappedRow.phone ? String(mappedRow.phone).trim() : null,
                  taxId: mappedRow.taxId ? String(mappedRow.taxId).trim() : null,
                },
              });
              importedCount++;
            } else if (entityType === "VENDOR" && mappedRow.name) {
              await tx.vendor.create({
                data: {
                  tenantId,
                  orgId: targetOrganization!.id,
                  name: String(mappedRow.name).trim(),
                  email: mappedRow.email ? String(mappedRow.email).trim() : null,
                  phone: mappedRow.phone ? String(mappedRow.phone).trim() : null,
                  taxId: mappedRow.taxId ? String(mappedRow.taxId).trim() : null,
                },
              });
              importedCount++;
            } else if (entityType === "ITEM" && mappedRow.name) {
              await tx.product.create({
                data: {
                  tenantId,
                  orgId: targetOrganization!.id,
                  name: String(mappedRow.name).trim(),
                  sku: mappedRow.sku || `SKU-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
                  sellPrice: mappedRow.price ? Number(mappedRow.price) : 0,
                  costPrice: mappedRow.costPrice ? Number(mappedRow.costPrice) : 0,
                  type: "GOODS",
                },
              });
              importedCount++;
            }
          }
        });
      }

      // Update job to completed
      const updatedJob = await prisma.masterDataImportJob.update({
        where: { id: job.id },
        data: {
          status: "COMPLETED",
          processedRows: rows.length,
          successRows: importedCount,
          completedAt: new Date(),
        },
      });

      // Update tenant onboarding progress flag
      await prisma.tenantOnboardingProgress.upsert({
        where: { tenantId },
        create: {
          tenantId,
          dataImported: true,
          completedSteps: ["DATA_INGESTION"],
          percentComplete: 80,
        },
        update: {
          dataImported: true,
        },
      });

      return {
        jobId: updatedJob.id,
        status: "COMPLETED",
        totalRows: rows.length,
        successRows: importedCount,
        errorRows: validation.errorRows,
        completedAt: updatedJob.completedAt,
      };
    } catch (err: any) {
      this.logger.error(`Master data import failed for tenant ${tenantId}: ${err.message}`, err.stack);
      await prisma.masterDataImportJob.update({
        where: { id: job.id },
        data: {
          status: "FAILED",
          errorDetails: [{ message: err.message }] as any,
          completedAt: new Date(),
        },
      });
      throw new BadRequestException(`Master data import failed: ${err.message}`);
    }
  }

  /**
   * Retrieves import jobs for a tenant.
   */
  async getTenantImportJobs(tenantId: string) {
    return prisma.masterDataImportJob.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
      take: 20,
    });
  }
}
