/**
 * D04 — legal entities, business units, branches, teams and cost centres
 * are all OrgUnit kinds; OrgPosition models the reporting hierarchy
 * ApprovalRoutingService climbs. Both strictly tenant-scoped.
 */
import { Injectable, BadRequestException } from "@nestjs/common";
import { prisma } from "@kannan19302/database";
import { idpClient as idpPrisma } from "../../common/idp-client";

const ORG_UNIT_KINDS = new Set(["LEGAL_ENTITY", "BUSINESS_UNIT", "BRANCH", "TEAM", "COST_CENTRE"]);

@Injectable()
export class OrgStructureService {
  async createOrgUnit(tenantId: string, data: { name: string; kind: string; parentId?: string }) {
    if (!ORG_UNIT_KINDS.has(data.kind)) {
      throw new BadRequestException(`Unknown org unit kind "${data.kind}"`);
    }
    const name = data.name.trim();
    if (!name) throw new BadRequestException("Organization unit name is required");
    if (data.parentId) {
      const parent = await (prisma as any).orgUnit.findFirst({
        where: { id: data.parentId, tenantId },
      });
      if (!parent) throw new BadRequestException("Parent organization unit not found in this organization");
    }
    return (prisma as any).orgUnit.create({
      data: { tenantId, name, kind: data.kind, parentId: data.parentId ?? null },
    });
  }

  async listOrgUnits(tenantId: string) {
    return (prisma as any).orgUnit.findMany({
      where: { tenantId },
      orderBy: [{ kind: "asc" }, { name: "asc" }, { id: "asc" }],
    });
  }

  async createPosition(tenantId: string, data: { orgUnitId: string; title: string; managerPositionId?: string; occupantUserId?: string }) {
    const title = data.title.trim();
    if (!title) throw new BadRequestException("Position title is required");
    const orgUnit = await (prisma as any).orgUnit.findFirst({
      where: { id: data.orgUnitId, tenantId },
    });
    if (!orgUnit) throw new BadRequestException("Organization unit not found in this organization");
    if (data.managerPositionId) {
      const managerPosition = await (prisma as any).orgPosition.findFirst({
        where: { id: data.managerPositionId, tenantId },
      });
      if (!managerPosition) throw new BadRequestException("Manager position not found in this organization");
    }
    if (data.occupantUserId) {
      const occupant = await idpPrisma.user.findFirst({
        where: { id: data.occupantUserId, tenantId, deletedAt: null },
        select: { id: true },
      });
      if (!occupant) throw new BadRequestException("Position occupant not found in this organization");
    }
    return (prisma as any).orgPosition.create({
      data: {
        tenantId,
        orgUnitId: data.orgUnitId,
        title,
        managerPositionId: data.managerPositionId ?? null,
        occupantUserId: data.occupantUserId ?? null,
      },
    });
  }

  async listPositions(tenantId: string) {
    return (prisma as any).orgPosition.findMany({
      where: { tenantId },
      orderBy: [{ title: "asc" }, { id: "asc" }],
    });
  }

  /** The OCC organization-graph read model. It uses canonical D04 rows only. */
  async getOrganizationGraph(tenantId: string) {
    const [units, positions] = await Promise.all([
      this.listOrgUnits(tenantId),
      this.listPositions(tenantId),
    ]);
    return { units, positions };
  }
}
