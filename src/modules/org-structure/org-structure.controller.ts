/**
 * D04 — HTTP surface for org structure and approval routing.
 */
import { Controller, Get, Post, Body, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RbacGuard } from "../../common/guards/rbac.guard";
import { Permissions } from "../../common/decorators/permissions.decorator";
import { OrgStructureService } from "./org-structure.service";
import { ApprovalRoutingService } from "./approval-routing.service";

interface AuthenticatedRequest extends Request {
  user: { tenantId: string; userId: string };
}

interface CreateOrgUnitBody {
  name: string;
  kind: string;
  parentId?: string;
}

interface CreatePositionBody {
  orgUnitId: string;
  title: string;
  managerPositionId?: string;
  occupantUserId?: string;
}

interface RouteApprovalBody {
  requestId: string;
  startPositionId: string;
  maxLevels?: number;
}

@Controller("org-structure")
@UseGuards(JwtAuthGuard, RbacGuard)
export class OrgStructureController {
  constructor(
    private readonly orgStructure: OrgStructureService,
    private readonly approvalRouting: ApprovalRoutingService,
  ) {}

  @Get("units")
  @Permissions("admin.org.read")
  async listUnits(@Req() req: AuthenticatedRequest) {
    return this.orgStructure.listOrgUnits(req.user.tenantId);
  }

  @Post("units")
  @Permissions("admin.org.manage")
  async createUnit(@Req() req: AuthenticatedRequest, @Body() body: CreateOrgUnitBody) {
    return this.orgStructure.createOrgUnit(req.user.tenantId, body);
  }

  @Get("positions")
  @Permissions("admin.org.read")
  async listPositions(@Req() req: AuthenticatedRequest) {
    return this.orgStructure.listPositions(req.user.tenantId);
  }

  @Post("positions")
  @Permissions("admin.org.manage")
  async createPosition(@Req() req: AuthenticatedRequest, @Body() body: CreatePositionBody) {
    return this.orgStructure.createPosition(req.user.tenantId, body);
  }

  @Post("approvals/route")
  @Permissions("admin.org.manage")
  async routeApproval(@Req() req: AuthenticatedRequest, @Body() body: RouteApprovalBody) {
    return this.approvalRouting.routeApproval(req.user.tenantId, body.requestId, body.startPositionId, body.maxLevels ?? 3);
  }
}
