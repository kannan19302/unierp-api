import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { prisma } from "@kannan19302/database";

export interface FieldDiff {
  field: string;
  desiredValue: unknown;
  observedValue: unknown;
}

/**
 * M07 — the resource model: desired state, actual state, dependency graph,
 * drift detection. Every managed thing the platform provisions is declared
 * here once (M09-M15, the operation pipeline, is what actually calls
 * providers to make actual state match desired — this phase only models
 * the two states and the gap between them).
 */
@Injectable()
export class ResourceModelService {
  async registerResourceKind(name: string, description?: string) {
    return (prisma as any).resourceKind.upsert({
      where: { name },
      create: { name, description: description ?? null },
      update: { description: description ?? null },
    });
  }

  async createResource(kindName: string, name: string, initialDesiredState?: Record<string, unknown>) {
    const kind = await (prisma as any).resourceKind.findUnique({ where: { name: kindName } });
    if (!kind) {
      throw new BadRequestException(`No resource kind registered with name "${kindName}"`);
    }
    const resource = await (prisma as any).resource.create({ data: { kindId: kind.id, name } });
    if (initialDesiredState) {
      await this.setDesiredState(resource.id, initialDesiredState);
    }
    return resource;
  }

  async setDesiredState(resourceId: string, state: Record<string, unknown>) {
    const existing = await (prisma as any).desiredState.findUnique({ where: { resourceId } });
    const version = (existing?.version ?? 0) + 1;
    const updated = await (prisma as any).desiredState.upsert({
      where: { resourceId },
      create: { resourceId, state, version },
      update: { state, version },
    });
    // M14: every version is kept, not just the current one — otherwise
    // "roll back to any prior version" has nothing to roll back to.
    await (prisma as any).desiredStateVersion.create({
      data: { resourceId, version, state },
    });
    return updated;
  }

  async getDesiredState(resourceId: string) {
    return (prisma as any).desiredState.findUnique({ where: { resourceId } });
  }

  async getDesiredStateVersion(resourceId: string, version: number) {
    return (prisma as any).desiredStateVersion.findUnique({
      where: { resourceId_version: { resourceId, version } },
    });
  }

  async listDesiredStateVersions(resourceId: string) {
    return (prisma as any).desiredStateVersion.findMany({
      where: { resourceId },
      orderBy: { version: "asc" },
    });
  }

  /**
   * The exit criterion's central mechanism: report what a resource's actual
   * state currently is. If it diverges from desired, a DriftRecord is
   * created naming the fields that differ — not a bare "drifted: true".
   * A shallow, per-top-level-key comparison: nested values are compared as
   * a whole (via JSON equality) and reported as one differing field, which
   * is proportionate to what this phase's own exit criterion asks for.
   */
  async reportObservedState(resourceId: string, state: Record<string, unknown>) {
    await (prisma as any).observedState.upsert({
      where: { resourceId },
      create: { resourceId, state },
      update: { state, observedAt: new Date() },
    });

    const desired = await (prisma as any).desiredState.findUnique({ where: { resourceId } });
    if (!desired) {
      return { diff: [] as FieldDiff[], driftRecord: null };
    }

    const diff = this.diffStates(desired.state as Record<string, unknown>, state);
    if (diff.length === 0) {
      return { diff, driftRecord: null };
    }

    const driftRecord = await (prisma as any).driftRecord.create({
      data: { resourceId, diff },
    });
    return { diff, driftRecord };
  }

  /** Exported for direct testing — the diff logic is the exit criterion's
   *  own requirement ("a diff naming the fields"), so it must be provably
   *  correct on its own, not only through the record it produces. */
  diffStates(desired: Record<string, unknown>, observed: Record<string, unknown>): FieldDiff[] {
    const fields = new Set([...Object.keys(desired), ...Object.keys(observed)]);
    const diffs: FieldDiff[] = [];
    for (const field of fields) {
      const desiredValue = desired[field];
      const observedValue = observed[field];
      if (JSON.stringify(desiredValue) !== JSON.stringify(observedValue)) {
        diffs.push({ field, desiredValue, observedValue });
      }
    }
    return diffs;
  }

  async getOpenDrift(resourceId: string) {
    return (prisma as any).driftRecord.findMany({ where: { resourceId, resolved: false } });
  }

  async resolveDrift(driftRecordId: string) {
    return (prisma as any).driftRecord.update({
      where: { id: driftRecordId },
      data: { resolved: true, resolvedAt: new Date() },
    });
  }

  /**
   * Refuses a cycle. A cycle would exist if `dependsOnId` can already reach
   * `resourceId` through existing edges — adding resourceId -> dependsOnId
   * on top of that closes the loop. Checked by walking the existing graph
   * from dependsOnId before the edge is written, not after.
   */
  async addDependency(resourceId: string, dependsOnId: string) {
    if (resourceId === dependsOnId) {
      throw new BadRequestException(`A resource cannot depend on itself (${resourceId})`);
    }
    const wouldCycle = await this.canReach(dependsOnId, resourceId);
    if (wouldCycle) {
      throw new BadRequestException(
        `Adding this dependency would create a cycle: "${dependsOnId}" already (transitively) depends on "${resourceId}"`,
      );
    }
    return (prisma as any).dependency.create({ data: { resourceId, dependsOnId } });
  }

  /** Does `fromId` transitively depend on `toId`, following existing edges? */
  private async canReach(fromId: string, toId: string): Promise<boolean> {
    const visited = new Set<string>();
    const queue = [fromId];
    while (queue.length > 0) {
      const current = queue.shift()!;
      if (current === toId) return true;
      if (visited.has(current)) continue;
      visited.add(current);
      const edges = await (prisma as any).dependency.findMany({ where: { resourceId: current } });
      for (const edge of edges) {
        queue.push(edge.dependsOnId);
      }
    }
    return false;
  }

  async getDependents(resourceId: string): Promise<Array<{ id: string; name: string }>> {
    const edges = await (prisma as any).dependency.findMany({
      where: { dependsOnId: resourceId },
      include: { resource: true },
    });
    return edges.map((e: any) => ({ id: e.resource.id, name: e.resource.name }));
  }

  /**
   * Refuses when other resources depend on this one, naming them —
   * checked and reported BEFORE any database delete is attempted, so the
   * caller sees "these three resources depend on it" rather than a raw
   * foreign-key violation with no indication of which rows caused it.
   */
  async deleteResource(resourceId: string): Promise<void> {
    const resource = await (prisma as any).resource.findUnique({ where: { id: resourceId } });
    if (!resource) {
      throw new NotFoundException(`Resource ${resourceId} not found`);
    }
    const dependents = await this.getDependents(resourceId);
    if (dependents.length > 0) {
      throw new BadRequestException(
        `Cannot delete "${resource.name}" (${resourceId}): ${dependents.length} resource(s) depend on it: ` +
          dependents.map((d) => `${d.name} (${d.id})`).join(", "),
      );
    }
    await (prisma as any).resource.delete({ where: { id: resourceId } });
  }

  /**
   * M15 — server-side search across every resource kind, backing the
   * console's estate view. `limit` is hard-capped at 100 regardless of what
   * is requested: the exit criterion this supports ("no limit > 100 page")
   * is enforced here, once, rather than trusted to every caller.
   */
  async searchResources(params: {
    kindName?: string;
    nameContains?: string;
    sortBy?: "name" | "createdAt";
    sortDir?: "asc" | "desc";
    cursor?: number;
    limit?: number;
  }): Promise<{ items: Array<{ id: string; name: string; kindName: string; createdAt: Date }>; total: number; nextCursor: number | null }> {
    const limit = Math.min(Math.max(params.limit ?? 25, 1), 100);
    const cursor = Math.max(params.cursor ?? 0, 0);
    const where: Record<string, unknown> = {};
    if (params.nameContains) {
      where.name = { contains: params.nameContains, mode: "insensitive" };
    }
    if (params.kindName) {
      where.kind = { name: params.kindName };
    }
    const sortBy = params.sortBy ?? "createdAt";
    const sortDir = params.sortDir ?? "desc";

    const [rows, total] = await Promise.all([
      (prisma as any).resource.findMany({
        where,
        include: { kind: true },
        orderBy: { [sortBy]: sortDir },
        skip: cursor,
        take: limit,
      }),
      (prisma as any).resource.count({ where }),
    ]);

    const items = rows.map((r: any) => ({ id: r.id, name: r.name, kindName: r.kind.name, createdAt: r.createdAt }));
    const nextCursor = cursor + items.length < total ? cursor + items.length : null;
    return { items, total, nextCursor };
  }
}
