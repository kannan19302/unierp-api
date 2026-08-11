import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Param,
  UseGuards,
  Req,
} from "@nestjs/common";
import { ApiTags, ApiOperation, ApiBearerAuth } from "@nestjs/swagger";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RbacGuard } from "../../common/guards/rbac.guard";
import { ControlPlaneGuard } from '../../common/guards/control-plane.guard';
import { Permissions } from "../../common/decorators/permissions.decorator";
import { SkipTenantScope } from '../../common/decorators/skip-tenant-scope.decorator';
import { SaasWhiteLabelDeepService } from "./white-label.service";

@ApiTags("SaasWhiteLabelDeep")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RbacGuard, ControlPlaneGuard)
@Controller("platform/v1/white-label-deep")
@SkipTenantScope()
export class SaasWhiteLabelDeepController {
  constructor(private readonly whiteLabelService: SaasWhiteLabelDeepService) {}

  @ApiOperation({ summary: "Get custom domains" })
  @Permissions("system.whitelabel.read")
  @Get("domains")
  async getDomains(@Req() req: any) {
    return this.whiteLabelService.getDomains(req.user.tenantId);
  }

  @ApiOperation({ summary: "Add custom domain" })
  @Permissions("system.whitelabel.create")
  @Post("domains")
  async addCustomDomain(
    @Req() req: any,
    @Body() dto: { customDomain: string; brandingConfig?: any },
  ) {
    return this.whiteLabelService.addCustomDomain(req.user.tenantId, dto);
  }

  @ApiOperation({ summary: "Verify custom domain DNS" })
  @Permissions("system.whitelabel.update")
  @Put("domains/:id/verify")
  async verifyDomain(@Req() req: any, @Param("id") id: string) {
    return this.whiteLabelService.verifyDomain(req.user.tenantId, id);
  }

  @ApiOperation({ summary: "Issue SSL certificate" })
  @Permissions("system.whitelabel.update")
  @Post("domains/:id/ssl")
  async issueSslCert(@Req() req: any, @Param("id") domainId: string) {
    return this.whiteLabelService.issueSslCert(req.user.tenantId, domainId);
  }
}
