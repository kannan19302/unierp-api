import { Controller, Get, UseGuards, Req, Query } from "@nestjs/common";
import { ApiTags, ApiOperation, ApiBearerAuth } from "@nestjs/swagger";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RbacGuard } from "../../common/guards/rbac.guard";
import { Permissions } from "../../common/decorators/permissions.decorator";
import { SaasPortalAuditTrailDeepService } from "./audit-trail.service";

@ApiTags("SaasPortalAuditTrailDeep")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RbacGuard)
@Controller("saas-portal/audit-trail-deep")
export class SaasPortalAuditTrailDeepController {
  constructor(private readonly auditService: SaasPortalAuditTrailDeepService) {}

  @ApiOperation({ summary: "Search/filter the tenant's audit trail — who changed what, and when" })
  @Permissions("saas_portal.audit.read")
  @Get("logs")
  async getAuditLogs(
    @Req() req: any,
    @Query("entityType") entityType?: string,
    @Query("entityId") entityId?: string,
    @Query("userId") userId?: string,
    @Query("action") action?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("page") page?: string,
  ) {
    return this.auditService.getAuditLogs(
      req.user.tenantId,
      { entityType, entityId, userId, action, from: from ? new Date(from) : undefined, to: to ? new Date(to) : undefined },
      page ? Number(page) : 1,
    );
  }

  @ApiOperation({ summary: "Export the tenant's audit trail as evidence for an auditor" })
  @Permissions("saas_portal.audit.read")
  @Get("logs/export")
  async exportAuditLogs(
    @Req() req: any,
    @Query("entityType") entityType?: string,
    @Query("entityId") entityId?: string,
    @Query("userId") userId?: string,
    @Query("action") action?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
  ) {
    return this.auditService.exportAuditLogs(req.user.tenantId, {
      entityType,
      entityId,
      userId,
      action,
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
    });
  }
}
