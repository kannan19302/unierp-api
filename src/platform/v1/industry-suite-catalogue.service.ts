/**
 * M44 — products, modules, suites and marketplace bind. An industry suite
 * is composed and priced by summing its bound catalogue products, never a
 * second, hand-entered suite price. Provisioning goes through M07's
 * createResource() — never a direct estate mutation — matching this
 * track's own invariant.
 */
import { Injectable, BadRequestException, NotFoundException } from "@nestjs/common";
import { prisma } from "@kannan19302/database";
import { resolve as resolveCapability } from "@kannan19302/shared";
import { ResourceModelService } from "../resource-model/resource-model.service";

export interface CatalogueItemComposition {
  productId: string;
  name: string;
  capabilityId: string | null;
  priceCents: number;
}

export interface SuiteComposition {
  suiteId: string;
  items: CatalogueItemComposition[];
  totalPriceCents: number;
}

@Injectable()
export class IndustrySuiteCatalogueService {
  constructor(private readonly resources: ResourceModelService) {}

  /**
   * Composes and prices a suite by reading its bound products and summing
   * their priceCents — the ONLY place a suite's total price is computed,
   * so "composed and priced from the catalogue" is literally true rather
   * than a separately maintained number that can drift from the items.
   */
  async composeSuite(suiteId: string): Promise<SuiteComposition> {
    const suite = await (prisma as any).catalogueSuite.findUnique({ where: { id: suiteId } });
    if (!suite) throw new NotFoundException(`Suite "${suiteId}" not found`);

    const links = await (prisma as any).catalogueSuiteItem.findMany({ where: { suiteId } });
    const items: CatalogueItemComposition[] = [];
    let totalPriceCents = 0;

    for (const link of links) {
      const product = await (prisma as any).catalogueProduct.findUnique({ where: { id: link.productId } });
      if (!product) continue;
      items.push({ productId: product.id, name: product.name, capabilityId: product.capabilityId, priceCents: product.priceCents });
      totalPriceCents += product.priceCents;
    }

    return { suiteId, items, totalPriceCents };
  }

  /**
   * Refuses to provision a suite containing any product whose declared M02
   * capability is UNSATISFIED (no bound provider) — a suite that would
   * install half-working is never installed at all.
   */
  async provisionSuite(suiteId: string, tenantId: string) {
    const composition = await this.composeSuite(suiteId);

    const unsatisfied = composition.items.filter((item) => {
      if (!item.capabilityId) return false;
      return resolveCapability(item.capabilityId).state === "UNSATISFIED";
    });
    if (unsatisfied.length > 0) {
      throw new BadRequestException(
        `Cannot provision suite "${suiteId}": unsatisfied capabilities ${unsatisfied.map((i) => i.capabilityId).join(", ")}`,
      );
    }

    const resource = await this.resources.createResource("catalogue-suite-installation", `suite:${suiteId}:tenant:${tenantId}`, {
      suiteId,
      tenantId,
      items: composition.items,
    });

    const provisioning = await (prisma as any).catalogueProvisioning.create({
      data: {
        suiteId,
        tenantId,
        resourceId: resource.id,
        totalPriceCents: composition.totalPriceCents,
      },
    });

    return { provisioning, resource, composition };
  }
}
