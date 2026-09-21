/**
 * ControlPlaneAuditController — HTTP surface for the immutable audit spine.
 * Exposes audit log records with SHA-256 tamper-evident verification.
 */
import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ApiTags, ApiOperation, ApiBearerAuth } from "@nestjs/swagger";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RbacGuard } from "../../common/guards/rbac.guard";
import { ControlPlaneGuard } from "../../common/guards/control-plane.guard";
import { SkipTenantScope } from "../../common/decorators/skip-tenant-scope.decorator";
import { Permissions } from "../../common/decorators/permissions.decorator";
import { ControlPlaneAuditService } from "./control-plane-audit.service";

@ApiTags("platform")
@ApiBearerAuth()
@Controller("platform/v1/audit")
@UseGuards(JwtAuthGuard, RbacGuard, ControlPlaneGuard)
@SkipTenantScope()
export class ControlPlaneAuditController {
  constructor(private readonly audit: ControlPlaneAuditService) {}

  @ApiOperation({ summary: "Query control plane audit records" })
  @Get("records")
  @Permissions("system.audit.read")
  async queryRecords(
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string,
    @Query("search") search?: string,
    @Query("action") action?: string,
    @Query("actorId") actorId?: string,
    @Query("targetId") targetId?: string,
  ) {
    return this.audit.queryRecords({
      page: page ? parseInt(page, 10) : 1,
      pageSize: pageSize ? parseInt(pageSize, 10) : 25,
      search,
      action,
      actorId,
      targetId,
    });
  }

  @ApiOperation({ summary: "Get audit spine summary metrics" })
  @Get("stats")
  @Permissions("system.audit.read")
  async getStats() {
    return this.audit.getStats();
  }

  @ApiOperation({ summary: "Verify tamper-evident hash chain for an actor" })
  @Get("verify-chain/:actorId")
  @Permissions("system.audit.read", "system.compliance.read")
  async verifyChain(@Param("actorId") actorId: string) {
    return this.audit.verifyChain(actorId);
  }
}
