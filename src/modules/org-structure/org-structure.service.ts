/**
 * D04 — legal entities, business units, branches, teams and cost centres
 * are all OrgUnit kinds; OrgPosition models the reporting hierarchy
 * ApprovalRoutingService climbs. Both strictly tenant-scoped.
 */
import { Injectable, BadRequestException } from "@nestjs/common";
import { prisma } from "@kannan19302/database";

const ORG_UNIT_KINDS = new Set(["LEGAL_ENTITY", "BUSINESS_UNIT", "BRANCH", "TEAM", "COST_CENTRE"]);

@Injectable()
export class OrgStructureService {
  async createOrgUnit(tenantId: string, data: { name: string; kind: string; parentId?: string }) {
    if (!ORG_UNIT_KINDS.has(data.kind)) {
      throw new BadRequestException(`Unknown org unit kind "${data.kind}"`);
    }
    return (prisma as any).orgUnit.create({ data: { tenantId, name: data.name, kind: data.kind, parentId: data.parentId ?? null } });
  }

  async listOrgUnits(tenantId: string) {
    return (prisma as any).orgUnit.findMany({ where: { tenantId } });
  }

  async createPosition(tenantId: string, data: { orgUnitId: string; title: string; managerPositionId?: string; occupantUserId?: string }) {
    return (prisma as any).orgPosition.create({
      data: {
        tenantId,
        orgUnitId: data.orgUnitId,
        title: data.title,
        managerPositionId: data.managerPositionId ?? null,
        occupantUserId: data.occupantUserId ?? null,
      },
    });
  }

  async listPositions(tenantId: string) {
    return (prisma as any).orgPosition.findMany({ where: { tenantId } });
  }
}
