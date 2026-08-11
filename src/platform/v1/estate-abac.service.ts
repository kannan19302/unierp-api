/**
 * M33 — attribute-based authorisation over the estate, deliberately
 * independent of C02's RBAC permission registry. This file never calls
 * `hasPermission()` or consults a role's `platform.*`/`["*"]` grant —
 * "no platform.* wildcard satisfies an estate grant" is true because
 * there is no code path here that could read one.
 */
import { Injectable } from "@nestjs/common";
import { prisma } from "@kannan19302/database";

export type EstateCapability = "read" | "plan";

export interface EstateGrantScope {
  resourceKind?: string;
  region?: string;
  environment?: string;
  tenantId?: string;
  accountId?: string;
}

@Injectable()
export class EstateAbacService {
  async grant(subjectId: string, capability: EstateCapability, scope: EstateGrantScope) {
    return (prisma as any).estateGrant.create({
      data: { subjectId, capability, ...scope },
    });
  }

  /**
   * A resource's actual attribute values — kind from M07, region from
   * its desired state (the field M17's residency check already reads),
   * tenant/environment from M18's attribution. Not from anything the
   * grant itself declares — the grant's scope is compared against the
   * resource's REAL data, never assumed.
   */
  private async resourceAttributes(resourceId: string): Promise<{
    resourceKind: string;
    region: string | null;
    environment: string | null;
    tenantId: string | null;
  } | null> {
    const resource = await (prisma as any).resource.findUnique({ where: { id: resourceId }, include: { kind: true } });
    if (!resource) return null;

    const desired = await (prisma as any).desiredState.findUnique({ where: { resourceId } });
    const region = (desired?.state as any)?.region ?? null;

    const attribution = await (prisma as any).resourceAttribution.findUnique({ where: { resourceId } });

    return {
      resourceKind: resource.kind.name,
      region,
      environment: attribution?.environment ?? null,
      tenantId: attribution?.tenantId ?? null,
    };
  }

  private matches(grant: any, attrs: { resourceKind: string; region: string | null; environment: string | null; tenantId: string | null }): boolean {
    if (grant.resourceKind && grant.resourceKind !== attrs.resourceKind) return false;
    if (grant.region && grant.region !== attrs.region) return false;
    if (grant.environment && grant.environment !== attrs.environment) return false;
    if (grant.tenantId && grant.tenantId !== attrs.tenantId) return false;
    return true;
  }

  /** True only if some grant for this subject+capability matches every
   *  one of ITS OWN scoped dimensions against the resource's real
   *  attributes. No grants at all -> false, always -- there is no
   *  implicit "no grants means allow." */
  async isAuthorized(subjectId: string, resourceId: string, capability: EstateCapability): Promise<boolean> {
    const attrs = await this.resourceAttributes(resourceId);
    if (!attrs) return false;

    const grants = await (prisma as any).estateGrant.findMany({ where: { subjectId, capability } });
    return grants.some((g: any) => this.matches(g, attrs));
  }

  /**
   * Lists exactly the resources (from a candidate set) this subject can
   * act on — a region-scoped subject given candidates from TWO regions
   * gets back only the ones in their region: zero for the other region,
   * not a filtered "you can see it but not touch it" partial view.
   */
  async listAuthorizedResourceIds(subjectId: string, capability: EstateCapability, candidateResourceIds: string[]): Promise<string[]> {
    const authorized: string[] = [];
    for (const resourceId of candidateResourceIds) {
      if (await this.isAuthorized(subjectId, resourceId, capability)) {
        authorized.push(resourceId);
      }
    }
    return authorized;
  }
}
