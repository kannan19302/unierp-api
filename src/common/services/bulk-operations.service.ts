import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { prisma } from "@kannan19302/database";
import { idpClient as idpPrisma } from "@/common/idp-client";

interface BulkOperationResult {
  succeeded: number;
  failed: number;
  errors: { index?: number; id?: string; message: string }[];
  total: number;
}

const ALLOWED_BULK_MODELS = new Set([
  "customer",
  "vendor",
  "contact",
  "lead",
  "employee",
  "product",
  "invoice",
  "purchaseOrder",
  "salesOrder",
  "quotation",
  "deliveryNote",
  "paymentEntry",
  "journalEntry",
  "project",
  "task",
  "warehouse",
  "user",
  "role",
  "account",
  "budget",
  "asset",
  "department",
  "designation",
  "leaveApplication",
  "expenseClaim",
  "opportunity",
  "campaign",
]);

const TENANT_MODELS = new Set([
  "customer",
  "vendor",
  "contact",
  "lead",
  "employee",
  "product",
  "invoice",
  "purchaseOrder",
  "salesOrder",
  "quotation",
  "deliveryNote",
  "paymentEntry",
  "journalEntry",
  "project",
  "task",
  "warehouse",
  "account",
  "budget",
  "asset",
  "department",
  "designation",
  "leaveApplication",
  "expenseClaim",
  "opportunity",
  "campaign",
]);

// E07 — "a 10,000-row bulk edit reports per-row outcomes, does not time
// out, and does not lock the table for other tenants." Every write method
// below previously wrapped its ENTIRE loop (all N records) in one single
// prisma.$transaction. At 10,000 rows that (a) blows past any realistic
// transaction timeout, (b) holds row/table locks for the whole operation's
// duration, and (c) on Postgres, a single failing statement aborts the
// WHOLE transaction — every subsequent write in the loop then throws too,
// so "per-row outcomes" silently becomes "everything after the first
// failure is misreported as failed." CONCURRENCY_BATCH_SIZE bounds how
// many independent, individually-atomic writes run at once — no write
// shares a transaction with any other, so one row's failure can never
// affect another row's outcome, and no lock is ever held across the whole
// operation.
const CONCURRENCY_BATCH_SIZE = 50;

@Injectable()
export class BulkOperationsService {
  constructor(private readonly eventEmitter?: EventEmitter2) {}

  /**
   * Runs `perItem` for every item in `items`, CONCURRENCY_BATCH_SIZE at a
   * time, with no shared transaction across items — each item's own write
   * is its own atomic operation. Never accumulates into one long-running,
   * lock-holding, timeout-prone transaction regardless of `items.length`.
   */
  private async runBatched<T>(
    items: T[],
    perItem: (item: T, index: number) => Promise<{ ok: true } | { ok: false; message: string }>,
  ): Promise<BulkOperationResult> {
    const result: BulkOperationResult = { succeeded: 0, failed: 0, errors: [], total: items.length };
    for (let start = 0; start < items.length; start += CONCURRENCY_BATCH_SIZE) {
      const batch = items.slice(start, start + CONCURRENCY_BATCH_SIZE);
      const outcomes = await Promise.all(
        batch.map(async (item, offsetInBatch) => {
          const index = start + offsetInBatch;
          try {
            return { index, item, outcome: await perItem(item, index) };
          } catch (err: any) {
            return { index, item, outcome: { ok: false as const, message: err.message || "Unknown error" } };
          }
        }),
      );
      for (const { index, item, outcome } of outcomes) {
        if (outcome.ok) {
          result.succeeded++;
        } else {
          result.failed++;
          const id = typeof item === "string" ? item : undefined;
          result.errors.push({ index, id, message: outcome.message });
        }
      }
    }
    return result;
  }

  private getModel(modelName: string): any {
    if (!ALLOWED_BULK_MODELS.has(modelName)) {
      throw new BadRequestException(
        `Model '${modelName}' is not allowed for bulk operations`,
      );
    }
    const model = (prisma as any)[modelName];
    if (!model || typeof model.create !== "function") {
      throw new BadRequestException(`Invalid Prisma model: ${modelName}`);
    }
    return model;
  }

  private addTenantScope(tenantId: string, modelName: string, data: any): any {
    if (TENANT_MODELS.has(modelName)) {
      return { ...data, tenantId };
    }
    return data;
  }

  async bulkCreate(
    tenantId: string,
    modelName: string,
    records: any[],
  ): Promise<BulkOperationResult> {
    if (!records || records.length === 0) {
      throw new BadRequestException("Records array is required");
    }
    this.getModel(modelName);

    const result = await this.runBatched(records, async (record) => {
      const scoped = this.addTenantScope(tenantId, modelName, record);
      await (prisma as any)[modelName].create({ data: scoped });
      return { ok: true };
    });

    if (this.eventEmitter) {
      this.eventEmitter.emit("bulk-ops.create.completed", {
        tenantId,
        modelName,
        succeeded: result.succeeded,
        failed: result.failed,
        total: result.total,
      });
    }

    return result;
  }

  async bulkUpdate(
    tenantId: string,
    modelName: string,
    ids: string[],
    updates: Record<string, any>,
  ): Promise<BulkOperationResult> {
    if (!ids || ids.length === 0) {
      throw new BadRequestException("IDs array is required");
    }
    this.getModel(modelName);

    const result = await this.runBatched(ids, async (id) => {
      const where: any = { id };
      if (TENANT_MODELS.has(modelName)) {
        where.tenantId = tenantId;
      }
      const existing = await (prisma as any)[modelName].findUnique({ where });
      if (!existing) {
        return { ok: false, message: `Record ${id} not found` };
      }
      await (prisma as any)[modelName].update({ where, data: updates });
      return { ok: true };
    });

    if (this.eventEmitter) {
      this.eventEmitter.emit("bulk-ops.update.completed", {
        tenantId,
        modelName,
        succeeded: result.succeeded,
        failed: result.failed,
        total: result.total,
      });
    }

    return result;
  }

  async bulkDelete(
    tenantId: string,
    modelName: string,
    ids: string[],
  ): Promise<BulkOperationResult> {
    if (!ids || ids.length === 0) {
      throw new BadRequestException("IDs array is required");
    }
    this.getModel(modelName);

    const result = await this.runBatched(ids, async (id) => {
      const where: any = { id };
      if (TENANT_MODELS.has(modelName)) {
        where.tenantId = tenantId;
      }
      const existing = await (prisma as any)[modelName].findUnique({ where });
      if (!existing) {
        return { ok: false, message: `Record ${id} not found` };
      }
      await (prisma as any)[modelName].update({ where, data: { deletedAt: new Date() } });
      return { ok: true };
    });

    if (this.eventEmitter) {
      this.eventEmitter.emit("bulk-ops.delete.completed", {
        tenantId,
        modelName,
        succeeded: result.succeeded,
        failed: result.failed,
        total: result.total,
      });
    }

    return result;
  }

  async bulkRestore(
    tenantId: string,
    modelName: string,
    ids: string[],
  ): Promise<BulkOperationResult> {
    if (!ids || ids.length === 0) {
      throw new BadRequestException("IDs array is required");
    }
    this.getModel(modelName);

    const result = await this.runBatched(ids, async (id) => {
      const where: any = { id };
      if (TENANT_MODELS.has(modelName)) {
        where.tenantId = tenantId;
      }
      const existing = await (prisma as any)[modelName].findUnique({ where });
      if (!existing) {
        return { ok: false, message: `Record ${id} not found` };
      }
      await (prisma as any)[modelName].update({ where, data: { deletedAt: null } });
      return { ok: true };
    });

    if (this.eventEmitter) {
      this.eventEmitter.emit("bulk-ops.restore.completed", {
        tenantId,
        modelName,
        succeeded: result.succeeded,
        failed: result.failed,
        total: result.total,
      });
    }

    return result;
  }

  async bulkStatusChange(
    tenantId: string,
    modelName: string,
    ids: string[],
    status: string,
  ): Promise<BulkOperationResult> {
    if (!ids || ids.length === 0) {
      throw new BadRequestException("IDs array is required");
    }
    if (!status) {
      throw new BadRequestException("Status value is required");
    }
    this.getModel(modelName);

    const result = await this.runBatched(ids, async (id) => {
      const where: any = { id };
      if (TENANT_MODELS.has(modelName)) {
        where.tenantId = tenantId;
      }
      const existing = await (prisma as any)[modelName].findUnique({ where });
      if (!existing) {
        return { ok: false, message: `Record ${id} not found` };
      }
      await (prisma as any)[modelName].update({ where, data: { status } });
      return { ok: true };
    });

    if (this.eventEmitter) {
      this.eventEmitter.emit("bulk-ops.status-change.completed", {
        tenantId,
        modelName,
        status,
        succeeded: result.succeeded,
        failed: result.failed,
        total: result.total,
      });
    }

    return result;
  }
}
