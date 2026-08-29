import { Controller, Get, Post, UseGuards, Req } from "@nestjs/common";
import { z } from "zod";
import { ApiTags, ApiOperation, ApiBearerAuth } from "@nestjs/swagger";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RbacGuard } from "../../common/guards/rbac.guard";
import { Permissions } from "../../common/decorators/permissions.decorator";
import { SaasPortalSsoSamlDeepService } from "./sso-saml.service";
import { ZodBody } from "../../common/decorators/zod-body.decorator";

const samlConfigSchema = z.object({
  provider: z.string().min(1).max(255).optional(),
  issuerUrl: z.string().min(1).max(2048).optional(),
  ssoUrl: z.string().url().max(2048),
  metadataUrl: z.string().url().max(2048).optional(),
  certificate: z.string().min(1).max(50_000),
  enforceSso: z.boolean().optional(),
});

@ApiTags("SaasPortalSsoSamlDeep")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RbacGuard)
@Controller("saas-portal/sso-saml-deep")
export class SaasPortalSsoSamlDeepController {
  constructor(private readonly ssoService: SaasPortalSsoSamlDeepService) {}

  @ApiOperation({ summary: "Get portal SSO / SAML configurations" })
  @Permissions("saas_portal.sso.read")
  @Get("configs")
  async getSsoConfigs(@Req() req: any) {
    return this.ssoService.getSsoConfigs(req.user.tenantId);
  }

  @ApiOperation({ summary: "Configure portal SSO / SAML provider" })
  @Permissions("saas_portal.sso.update")
  @Post("configs")
  async configureSso(
    @Req() req: any,
    @ZodBody(samlConfigSchema) dto: z.infer<typeof samlConfigSchema>,
  ) {
    return this.ssoService.configureSso(req.user.tenantId, dto);
  }
}
