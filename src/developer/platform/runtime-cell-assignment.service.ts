import { ConflictException, Injectable } from "@nestjs/common";
import { prisma } from "@kannan19302/database";
import { RuntimeCellRouterService, type RuntimeCellPlacement } from "./runtime-cell-router.service";

/** Persists the otherwise deterministic default placement, making relocation
 * explicit and stable while retaining the hash router as bootstrap fallback. */
@Injectable()
export class RuntimeCellAssignmentService {
  private readonly db = prisma as any;
  constructor(private readonly router: RuntimeCellRouterService = new RuntimeCellRouterService()) {}

  async placement(tenantId: string): Promise<RuntimeCellPlacement> {
    const existing = await this.db.runtimeCellAssignment.findFirst({ where: { tenantId, status: "ACTIVE" } });
    if (existing) return this.toPlacement(existing);
    const initial = this.router.place(tenantId);
    try {
      const created = await this.db.runtimeCellAssignment.create({ data: { tenantId, ...initial } });
      await this.db.runtimeCellAssignmentEvent?.create?.({ data: { tenantId, assignmentId: created.id, action: "ASSIGNED", target: initial } });
      return this.toPlacement(created);
    } catch {
      // Another API worker may win the tenant's unique assignment race.
      const winner = await this.db.runtimeCellAssignment.findFirst({ where: { tenantId, status: "ACTIVE" } });
      if (!winner) throw new ConflictException("Unable to establish a stable runtime cell assignment");
      return this.toPlacement(winner);
    }
  }

  async relocate(tenantId: string, target: RuntimeCellPlacement, actorId?: string | null) {
    const current = await this.db.runtimeCellAssignment.findFirst({ where: { tenantId, status: "ACTIVE" } });
    if (!current) {
      await this.placement(tenantId);
      return this.relocate(tenantId, target);
    }
    if (current.cellId === target.cellId && current.region === target.region) return this.toPlacement(current);
    const previous = this.toPlacement(current);
    const operation = async (tx: any) => {
      const moved = await tx.runtimeCellAssignment.update({ where: { id: current.id }, data: { ...target, relocationCount: { increment: 1 } } });
      await tx.runtimeCellAssignmentEvent.create({ data: { tenantId, assignmentId: current.id, action: "RELOCATED", actorId: actorId ?? null, previous, target } });
      return moved;
    };
    const moved = this.db.$transaction ? await this.db.$transaction(operation) : await operation(this.db);
    return this.toPlacement(moved);
  }

  history(tenantId: string) {
    return this.db.runtimeCellAssignmentEvent.findMany({ where: { tenantId }, orderBy: { createdAt: "desc" }, take: 100 });
  }

  private toPlacement(value: any): RuntimeCellPlacement {
    return { cellId: value.cellId, shard: value.shard, region: value.region, topologyVersion: value.topologyVersion };
  }
}
