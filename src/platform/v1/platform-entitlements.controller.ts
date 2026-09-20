import { Controller, Get, Post, Body, Param, UseGuards } from "@nestjs/common";
import { ApiTags, ApiOperation, ApiBearerAuth } from "@nestjs/swagger";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RbacGuard } from "../../common/guards/rbac.guard";
import { ControlPlaneGuard } from "../../common/guards/control-plane.guard";
import { SkipTenantScope } from "../../common/decorators/skip-tenant-scope.decorator";
import { Permissions } from "../../common/decorators/permissions.decorator";
import {
  PlatformEntitlementsService,
  LicensePool,
  GenerateOfflineLicenseDto,
} from "./platform-entitlements.service";

@ApiTags("Platform Entitlements (PCC-05)")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RbacGuard, ControlPlaneGuard)
@Controller("platform/v1/entitlements")
@SkipTenantScope()
export class PlatformEntitlementsController {
  constructor(private readonly entitlementsService: PlatformEntitlementsService) {}

  @ApiOperation({ summary: "Get all active capability grants" })
  @Permissions("system.entitlements.read")
  @Get()
  async getActiveGrants() {
    return this.entitlementsService.getActiveGrants();
  }

  // --- License Pool Management (EC-05.1) ---

  @ApiOperation({ summary: "Get seat-based license pools" })
  @Permissions("system.entitlements.read")
  @Get("pools")
  async getPools() {
    return this.entitlementsService.getPools();
  }

  @ApiOperation({ summary: "Create license pool" })
  @Permissions("system.entitlements.write")
  @Post("pools")
  async createPool(@Body() dto: Partial<LicensePool>) {
    return this.entitlementsService.createPool(dto);
  }

  @ApiOperation({ summary: "Allocate pool seats to a tenant" })
  @Permissions("system.entitlements.write")
  @Post("pools/:poolId/allocate")
  async allocateSeats(
    @Param("poolId") poolId: string,
    @Body() body: { tenantId: string; seatCount: number }
  ) {
    return this.entitlementsService.allocateSeats(poolId, body.tenantId, body.seatCount);
  }

  // --- Module Grant Matrix (EC-05.2) ---

  @ApiOperation({ summary: "Get module grant matrix across tenants" })
  @Permissions("system.entitlements.read")
  @Get("matrix")
  async getGrantMatrix() {
    return this.entitlementsService.getGrantMatrix();
  }

  @ApiOperation({ summary: "Toggle module grant for a specific tenant" })
  @Permissions("system.entitlements.write")
  @Post("matrix/toggle")
  async toggleModuleGrant(
    @Body() body: { tenantId: string; moduleCode: string; enabled: boolean; effectiveDate?: string }
  ) {
    return this.entitlementsService.toggleModuleGrant(
      body.tenantId,
      body.moduleCode,
      body.enabled,
      body.effectiveDate
    );
  }

  @ApiOperation({ summary: "Bulk enable or disable a module across all tenants" })
  @Permissions("system.entitlements.write")
  @Post("matrix/bulk")
  async bulkToggle(
    @Body() body: { moduleCode: string; enabled: boolean }
  ) {
    return this.entitlementsService.bulkToggle(body.moduleCode, body.enabled);
  }

  // --- Offline Cryptographic License Generator (EC-05.3) ---

  @ApiOperation({ summary: "List issued offline cryptographic licenses" })
  @Permissions("system.entitlements.read")
  @Get("offline-licenses")
  async getOfflineLicenses() {
    return this.entitlementsService.getOfflineLicenses();
  }

  @ApiOperation({ summary: "Generate signed offline cryptographic enterprise license" })
  @Permissions("system.entitlements.write")
  @Post("offline-licenses/generate")
  async generateOfflineLicense(@Body() dto: GenerateOfflineLicenseDto) {
    return this.entitlementsService.generateOfflineLicense(dto);
  }
}
