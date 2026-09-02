import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  UseGuards,
  Req,
} from "@nestjs/common";
import { Request } from "express";
import { JwtAuthGuard } from "../../../common/guards/jwt-auth.guard";
import { RbacGuard } from "../../../common/guards/rbac.guard";
import { Permissions } from "../../../common/decorators/permissions.decorator";
import { ApiTags, ApiOperation, ApiBearerAuth } from "@nestjs/swagger";
import { OrganizationEntitlementsService } from "../services/organization-entitlements.service";

interface AuthenticatedRequest extends Request {
  user: { tenantId: string; userId: string; email: string; roles: string[] };
}

@ApiTags("tenant-admin")
@ApiBearerAuth()
@Controller("api/v1/organization-entitlements")
@UseGuards(JwtAuthGuard, RbacGuard)
export class OrganizationEntitlementsController {
  constructor(
    private readonly entitlementsService: OrganizationEntitlementsService,
  ) {}

  @ApiOperation({ summary: "Get organization entitlement and license pool summary" })
  @Get()
  @Permissions("occ.entitlements.access", "admin.users.read")
  async getSummary(@Req() req: AuthenticatedRequest) {
    const tenantId = req.user?.tenantId || "default-tenant";
    return this.entitlementsService.getSummary(tenantId);
  }

  @ApiOperation({ summary: "List member license allocations" })
  @Get("allocations")
  @Permissions("occ.entitlements.access", "admin.users.read")
  async listAllocations(@Req() req: AuthenticatedRequest) {
    const tenantId = req.user?.tenantId || "default-tenant";
    return this.entitlementsService.listAllocations(tenantId);
  }

  @ApiOperation({ summary: "Allocate entitlement license to member" })
  @Post("allocate")
  @Permissions("occ.entitlements.access", "admin.users.manage")
  async allocateLicense(
    @Req() req: AuthenticatedRequest,
    @Body()
    body: {
      userId: string;
      userName: string;
      userEmail: string;
      department: string;
      entitlements: string[];
    },
  ) {
    const tenantId = req.user?.tenantId || "default-tenant";
    return this.entitlementsService.allocateLicense(tenantId, body);
  }

  @ApiOperation({ summary: "Reclaim license allocation from inactive member" })
  @Post("reclaim/:id")
  @Permissions("occ.entitlements.access", "admin.users.manage")
  async reclaimLicense(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
  ) {
    const tenantId = req.user?.tenantId || "default-tenant";
    return this.entitlementsService.reclaimLicense(tenantId, id);
  }

  @ApiOperation({ summary: "List automatic entitlement assignment rules" })
  @Get("rules")
  @Permissions("occ.entitlements.access", "admin.users.read")
  async listAssignmentRules(@Req() req: AuthenticatedRequest) {
    const tenantId = req.user?.tenantId || "default-tenant";
    return this.entitlementsService.listAssignmentRules(tenantId);
  }

  @ApiOperation({ summary: "Create automatic entitlement assignment rule" })
  @Post("rules")
  @Permissions("occ.entitlements.access", "admin.users.manage")
  async saveAssignmentRule(
    @Req() req: AuthenticatedRequest,
    @Body()
    body: {
      name: string;
      targetType: "DEPARTMENT" | "ROLE";
      targetValue: string;
      entitlementCodes: string[];
    },
  ) {
    const tenantId = req.user?.tenantId || "default-tenant";
    return this.entitlementsService.saveAssignmentRule(tenantId, body);
  }
}
