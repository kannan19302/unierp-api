/**
 * M15 — bulk operations over the estate: one action applied to many
 * resources, one item at a time, with the outcome of each item committed
 * before the next is attempted. That per-item commit is the entire
 * "resumable, no repeat, no skip" guarantee: a process killed mid-run
 * leaves `cursor` pointing at the first item that was never started, so
 * `resume()` picks up there — it never re-runs a settled item and never
 * silently drops an unprocessed one.
 *
 * Deliberately NOT built on DurableExecutorCore (M12): that executor halts
 * the whole job and compensates on the first step failure, which is correct
 * for a single resource's multi-step plan but wrong here — one resource
 * failing must not abort the other 499. Failures are recorded per item and
 * the run continues.
 */
import { Injectable } from "@nestjs/common";
import { prisma } from "@kannan19302/database";

export interface BulkItemResult {
  resourceId: string;
  status: "PENDING" | "SUCCESS" | "FAILED";
  error?: string;
}

export interface BulkOperationState {
  id: string;
  kind: string;
  status: "PENDING" | "RUNNING" | "DONE" | "FAILED";
  cursor: number;
  items: BulkItemResult[];
}

export type BulkAction = (resourceId: string) => Promise<void>;

@Injectable()
export class BulkOperationService {
  async start(kind: string, resourceIds: string[], action: BulkAction): Promise<BulkOperationState> {
    if (resourceIds.length === 0) {
      throw new Error("bulk operation requires at least one resourceId");
    }
    const items: BulkItemResult[] = resourceIds.map((resourceId) => ({ resourceId, status: "PENDING" }));
    const row = await (prisma as any).platformBulkOperation.create({
      data: { kind, status: "PENDING", cursor: 0, items },
    });
    return this.run(this.fromRow(row), action);
  }

  async resume(id: string, action: BulkAction): Promise<BulkOperationState> {
    const row = await (prisma as any).platformBulkOperation.findUnique({ where: { id } });
    if (!row) throw new Error(`No bulk operation "${id}" to resume — it was never created`);
    const state = this.fromRow(row);
    if (state.status === "DONE" || state.status === "FAILED") return state;
    return this.run(state, action);
  }

  private async run(state: BulkOperationState, action: BulkAction): Promise<BulkOperationState> {
    state.status = "RUNNING";
    await this.save(state);

    for (let i = state.cursor; i < state.items.length; i++) {
      const item = state.items[i];
      if (!item) {
        throw new Error(`bulk operation "${state.id}" item ${i} missing — items array corrupted`);
      }
      try {
        await action(item.resourceId);
        state.items[i] = { resourceId: item.resourceId, status: "SUCCESS" };
      } catch (err) {
        state.items[i] = {
          resourceId: item.resourceId,
          status: "FAILED",
          error: err instanceof Error ? err.message : String(err),
        };
      }
      // The durable commit point: cursor advances only after this item's
      // outcome (success OR failure) has been written, so a crash here
      // resumes at exactly this item, never past it unrecorded.
      state.cursor = i + 1;
      await this.save(state);
    }

    state.status = state.items.some((it) => it.status === "FAILED") ? "FAILED" : "DONE";
    await this.save(state);
    return state;
  }

  private async save(state: BulkOperationState): Promise<void> {
    await (prisma as any).platformBulkOperation.update({
      where: { id: state.id },
      data: { status: state.status, cursor: state.cursor, items: state.items },
    });
  }

  private fromRow(row: any): BulkOperationState {
    return { id: row.id, kind: row.kind, status: row.status, cursor: row.cursor, items: row.items };
  }
}
