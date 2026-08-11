/**
 * M23 — the console-facing surface over certificate lifecycle. Every
 * response here is `CertificateSummary`: a redacted secret-ref, never
 * certificate material — there is no query parameter, header, or role
 * that changes what this controller can return, because the service
 * behind it has nowhere to read a raw value from.
 */
import { Controller, Get, Post, Param, Body, UseGuards } from "@nestjs/common";
import { ApiTags, ApiOperation, ApiBearerAuth } from "@nestjs/swagger";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RbacGuard } from "../../common/guards/rbac.guard";
import { ControlPlaneGuard } from "../../common/guards/control-plane.guard";
import { Permissions } from "../../common/decorators/permissions.decorator";
import { SkipTenantScope } from "../../common/decorators/skip-tenant-scope.decorator";
import { CertificateLifecycleService } from "./certificate-lifecycle.service";

@ApiTags("platform")
@ApiBearerAuth()
@Controller("platform/v1/certificates")
@UseGuards(JwtAuthGuard, RbacGuard, ControlPlaneGuard)
@SkipTenantScope()
export class CertificateLifecycleController {
  constructor(private readonly certificates: CertificateLifecycleService) {}

  @ApiOperation({ summary: "Get a certificate by id — returns a redacted secret-ref, never the certificate material" })
  @Get(":id")
  @Permissions("system.certificate.read")
  async get(@Param("id") id: string) {
    return this.certificates.get(id);
  }

  @ApiOperation({ summary: "Certificates within their expiry alert window" })
  @Get()
  @Permissions("system.certificate.read")
  async listAtRisk() {
    return this.certificates.checkExpiryAlerts();
  }

  @ApiOperation({ summary: "Rotate a certificate without downtime: issues a new one before retiring the old" })
  @Post(":id/rotate")
  @Permissions("system.certificate.manage")
  async rotate(@Param("id") id: string) {
    return this.certificates.rotate(id);
  }

  @ApiOperation({ summary: "Issue a new certificate for a domain" })
  @Post()
  @Permissions("system.certificate.manage")
  async issue(@Body() body: { tenantId: string; domainId: string; provider?: string }) {
    return this.certificates.issue(body.tenantId, body.domainId, body.provider);
  }
}
