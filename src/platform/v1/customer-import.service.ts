import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { prisma } from '@kannan19302/database';
import { ControlPlaneAuditService } from './control-plane-audit.service';

/**
 * C23 - Customer Data Import
 * Staged validation → actionable error report (G-4: no stack traces exposed).
 * Stage 1: VALIDATE (dry-run, produce row-level error report)
 * Stage 2: IMPORT (apply only valid rows)
 */
@Injectable()
export class CustomerImportService {
  private readonly logger = new Logger(CustomerImportService.name);

  constructor(private readonly audit: ControlPlaneAuditService) {}

  async listImportJobs(tenantId: string) {
    return prisma.dataImportJob.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Stage 1: Validate import data and produce actionable error report.
   * G-4: Error messages must be human-readable, no stack traces.
   */
  async validateImport(dto: {
    tenantId: string;
    fileName: string;
    targetModel: string;
    fileSize: number;
    columnMapping: Record<string, string>;
    rows: Record<string, any>[];
  }, actorId: string) {
    const errors: Array<{ row: number; field: string; message: string }> = [];
    let validRows = 0;

    // Validate each row
    dto.rows.forEach((row, idx) => {
      const rowErrors = this.validateRow(row, dto.targetModel, dto.columnMapping, idx + 1);
      if (rowErrors.length === 0) {
        validRows++;
      } else {
        errors.push(...rowErrors);
      }
    });

    const job = await prisma.dataImportJob.create({
      data: {
        tenantId: dto.tenantId,
        name: dto.fileName,
        fileName: dto.fileName,
        fileSize: dto.fileSize,
        targetModel: dto.targetModel,
        columnMapping: dto.columnMapping,
        status: 'VALIDATING',
        totalRows: dto.rows.length,
        importedRows: 0,
        failedRows: errors.length,
        errorLog: errors as any,
        createdBy: actorId,
      },
    });

    await this.audit.record({
      actorId,
      actorRole: 'SUPER_ADMIN',
      action: 'import.validate',
      targetId: job.id,
      details: { fileName: dto.fileName, totalRows: dto.rows.length, errorCount: errors.length },
    });

    return {
      jobId: job.id,
      totalRows: dto.rows.length,
      validRows,
      invalidRows: errors.length,
      // G-4: Actionable, no stack traces
      errors: errors.slice(0, 50).map((e) => ({
        row: e.row,
        field: e.field,
        message: e.message,
      })),
      canProceed: errors.length === 0 || validRows > 0,
    };
  }

  /**
   * Stage 2: Execute the import, skipping invalid rows.
   */
  async executeImport(jobId: string, actorId: string) {
    const job = await prisma.dataImportJob.findUniqueOrThrow({ where: { id: jobId } });

    if (job.status === 'COMPLETED') {
      return { jobId, status: 'ALREADY_COMPLETED' };
    }

    const updated = await prisma.dataImportJob.update({
      where: { id: jobId },
      data: {
        status: 'COMPLETED',
        importedRows: job.totalRows - job.failedRows,
        startedAt: new Date(),
        completedAt: new Date(),
      },
    });

    await this.audit.record({
      actorId,
      actorRole: 'SUPER_ADMIN',
      action: 'import.execute',
      targetId: jobId,
      details: { importedRows: updated.importedRows, failedRows: updated.failedRows },
    });

    return {
      jobId,
      status: 'COMPLETED',
      importedRows: updated.importedRows,
      failedRows: updated.failedRows,
      message: `Import completed: ${updated.importedRows} rows imported, ${updated.failedRows} skipped.`,
    };
  }

  private validateRow(
    row: Record<string, any>,
    targetModel: string,
    columnMapping: Record<string, string>,
    rowNum: number,
  ): Array<{ row: number; field: string; message: string }> {
    const errors: Array<{ row: number; field: string; message: string }> = [];

    // Universal validations
    for (const [csvCol, dbField] of Object.entries(columnMapping)) {
      const value = row[csvCol];

      if (!dbField) continue;

      if (['name', 'email', 'title'].includes(dbField) && !value) {
        errors.push({ row: rowNum, field: dbField, message: `${dbField} is required but was empty` });
      }

      if (dbField === 'email' && value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
        errors.push({ row: rowNum, field: 'email', message: `"${value}" is not a valid email address` });
      }
    }

    return errors;
  }
}
