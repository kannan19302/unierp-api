/**
 * M27 — the DB-backed wrapper around `allocateLineItems()` (pure
 * arithmetic, tested at 100% branch coverage in cost-allocation.spec.ts
 * with no database involved at all). This file's only job is fetching
 * M25's ingested line items and M18's attribution table and handing them
 * to that pure function — it deliberately contains no allocation logic
 * of its own to keep the arithmetic in exactly one, fully-covered place.
 */
import { Injectable, NotFoundException } from "@nestjs/common";
import { prisma } from "@kannan19302/database";
import { allocateLineItems, type AllocationResult, type ResourceAttributionLookup } from "./cost-allocation";

@Injectable()
export class CostAllocationService {
  async allocateBatch(providerId: string, period: string): Promise<AllocationResult> {
    const batch = await (prisma as any).costIngestionBatch.findUnique({
      where: { providerId_period: { providerId, period } },
      include: { lineItems: true },
    });
    if (!batch) {
      throw new NotFoundException(`No ingested batch for provider "${providerId}" period "${period}"`);
    }

    const attributions = await (prisma as any).resourceAttribution.findMany({});
    const byResourceId = new Map(attributions.map((a: any) => [a.resourceId, a]));

    const lookup = (resourceId: string): ResourceAttributionLookup | null => {
      const a = byResourceId.get(resourceId) as any;
      if (!a || !a.tenantId || !a.service || !a.environment || !a.owner) return null;
      return { tenantId: a.tenantId, service: a.service, environment: a.environment };
    };

    return allocateLineItems(
      batch.lineItems.map((li: any) => ({
        lineItemId: li.id,
        amount: li.amount.toString(),
        resourceId: li.resourceId,
        sharedResourceIds: (li.sharedResourceIds as string[] | null) ?? null,
      })),
      lookup,
    );
  }
}
