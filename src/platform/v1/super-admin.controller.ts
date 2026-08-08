import { prisma } from "@kannan19302/database";
import { idpClient as idpPrisma } from "@/common/idp-client";
import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  UseGuards,
  Req,
  Query,
  Res,
} from "@nestjs/common";
import { z } from "zod";
import { Request, Response } from "express";
import { ZodBody } from "../../common/decorators/zod-body.decorator";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RbacGuard } from "../../common/guards/rbac.guard";
import { ControlPlaneGuard } from "../../common/guards/control-plane.guard";
import { Permissions } from "../../common/decorators/permissions.decorator";
import { SkipTenantScope } from "../../common/decorators/skip-tenant-scope.decorator";
import { TwoPersonControl } from "../../common/decorators/two-person-control.decorator";
import { TwoPersonControlGuard } from "../../common/guards/two-person-control.guard";
import { SuperAdminService } from "./super-admin.service";
import { ApiTags, ApiOperation, ApiBearerAuth } from "@nestjs/swagger";

// Deliberately cross-tenant: this controller aggregates data across every
// tenant for the platform operator (e.g. `idpPrisma.user.count()` platform-wide).
// It is gated by `system.tenant.*` permissions, not tenant membership.
@ApiTags("admin")
@ApiBearerAuth()
@Controller("platform/v1/super-admin")
@UseGuards(JwtAuthGuard, RbacGuard, ControlPlaneGuard, TwoPersonControlGuard)
@SkipTenantScope()
export class SuperAdminController {
  constructor(private readonly superAdminService: SuperAdminService) {}

  private auditCtx(req: Request) {
    const user = (req as any).user;
    return {
      actorId: user?.userId ?? user?.sub ?? "unknown",
      actorRole: user?.realm ?? "provider",
      correlationId: req.headers["x-correlation-id"] as string | undefined,
      ipAddress: req.ip,
    };
  }

  @ApiOperation({ summary: "Get tenants" })
  @Get("tenants")
  @Permissions("system.tenant.read")
  @TwoPersonControl()
  async getTenants() {
    return this.superAdminService.getTenants();
  }

  @ApiOperation({ summary: "Get tenant detail" })
  @Get("tenants/:id")
  @Permissions("system.tenant.read")
  @TwoPersonControl()
  async getTenantDetail(@Param("id") id: string) {
    return this.superAdminService.getTenantDetail(id);
  }

  @ApiOperation({ summary: "Impersonate tenant admin" })
  @Post("tenants/:id/impersonate")
  @Permissions("system.tenant.impersonate")
  @TwoPersonControl()
  async impersonateTenant(
    @Param("id") id: string,
    @Req() req: Request,
  ) {
    const actorId = (req as any).user?.userId ?? "unknown";
    return this.superAdminService.impersonateTenant(id, actorId, this.auditCtx(req));
  }

  @ApiOperation({ summary: "Provision tenant" })
  @Post("tenants")
  @Permissions("system.tenant.create")
  async provisionTenant(
    @ZodBody(z.any())
    body: {
      name: string;
      slug: string;
      plan: string;
      adminEmail: string;
    },
    @Req() req: Request,
  ) {
    return this.superAdminService.provisionTenant(body, this.auditCtx(req));
  }

  @ApiOperation({ summary: "Update tenant" })
  @Patch("tenants/:id")
  @Permissions("system.tenant.update")
  async updateTenant(
    @Param("id") id: string,
    @ZodBody(z.any()) body: Record<string, unknown>,
    @Req() req: Request,
  ) {
    return this.superAdminService.updateTenant(id, body, this.auditCtx(req));
  }

  @ApiOperation({ summary: "Get all admins" })
  @Get("admins")
  @Permissions("system.superadmin.access")
  async getAllAdmins() {
    return this.superAdminService.getAllAdmins();
  }

  @ApiOperation({ summary: "Get analytics" })
  @Get("analytics")
  @Permissions("system.analytics.read")
  async getAnalytics() {
    return this.superAdminService.getAnalytics();
  }

  @ApiOperation({ summary: "Get system health" })
  @Get("health")
  @Permissions("system.health.read")
  async getSystemHealth() {
    return this.superAdminService.getSystemHealth();
  }

  @ApiOperation({ summary: "Cross-tenant search" })
  @Get("cross-tenant-search")
  @Permissions("system.tenant.read")
  async crossTenantSearch(
    @Req() req: Request,
    @Query("q") query: string,
    @Query("justification") justification: string,
  ) {
    return this.superAdminService.crossTenantSearch(
      query,
      justification,
      this.auditCtx(req)
    );
  }

  @ApiOperation({ summary: "Get tenant internal audit trail" })
  @Get("tenants/:id/audit-trail")
  @Permissions("system.tenant.read")
  async getTenantAuditTrail(
    @Param("id") id: string,
    @Query("page") page?: string,
    @Query("limit") limit?: string
  ) {
    const pageNum = page ? parseInt(page, 10) : 1;
    const limitNum = limit ? parseInt(limit, 10) : 50;
    return this.superAdminService.getTenantAuditTrail(id, pageNum, limitNum);
  }

  @ApiOperation({ summary: "Export tenant internal audit trail" })
  @Get("tenants/:id/audit-trail/export")
  @Permissions("system.tenant.read")
  async exportTenantAuditTrail(
    @Param("id") id: string,
    @Res() res: Response
  ) {
    const csvData = await this.superAdminService.exportTenantAuditTrail(id);
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename=tenant-${id}-audit-trail.csv`);
    return res.status(200).send(csvData);
  }
}
