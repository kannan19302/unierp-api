/**
 * M23 — the console-facing surface over certificate lifecycle. Every
 * response here is `CertificateSummary`: a redacted secret-ref, never
 * certificate material — there is no query parameter, header, or role
 * that changes what this controller can return, because the service
 * behind it has nowhere to read a raw value from.
 */
import { Controller, Get, Post, Delete, Param, Body, Query, UseGuards } from "@nestjs/common";
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

  @ApiOperation({ summary: "List active dynamic secret leases" })
  @Get("leases")
  @Permissions("system.certificate.read")
  async listLeases() {
    return this.certificates.listLeases();
  }

  @ApiOperation({ summary: "Issue dynamic secret lease" })
  @Post("leases")
  @Permissions("system.certificate.manage")
  async createLease(@Body() body: { secretKey: string; clientIdentity: string; ttlSeconds?: number }) {
    return this.certificates.createLease(body.secretKey, body.clientIdentity, body.ttlSeconds);
  }

  @ApiOperation({ summary: "Revoke dynamic secret lease" })
  @Delete("leases/:id")
  @Permissions("system.certificate.manage")
  async revokeLease(@Param("id") id: string, @Body() body?: { reason?: string }) {
    return this.certificates.revokeLease(id, body?.reason);
  }

  @ApiOperation({ summary: "View certificate chain (Root -> Intermediate -> Leaf)" })
  @Get("chain/:id")
  @Permissions("system.certificate.read")
  async getCertificateChain(@Param("id") id: string) {
    return this.certificates.getCertificateChain(id);
  }

  @ApiOperation({ summary: "Schedule auto-rotation for a certificate" })
  @Post(":id/schedule-rotation")
  @Permissions("system.certificate.manage")
  async scheduleRotation(@Param("id") id: string, @Body() body: { autoRotateDaysBefore: number }) {
    return this.certificates.scheduleRotation(id, body.autoRotateDaysBefore);
  }

  @ApiOperation({ summary: "Get a certificate by id — returns a redacted secret-ref, never the certificate material" })
  @Get(":id")
  @Permissions("system.certificate.read")
  async get(@Param("id") id: string) {
    return this.certificates.get(id);
  }

  @ApiOperation({ summary: "List certificates (all or within alert window)" })
  @Get()
  @Permissions("system.certificate.read")
  async list(@Query("all") all?: string) {
    if (all === "true" || all === "1") {
      return this.certificates.listAll();
    }
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

  @ApiOperation({ summary: "Revoke / delete a certificate" })
  @Delete(":id")
  @Permissions("system.certificate.manage")
  async revoke(@Param("id") id: string, @Body() body?: { reason?: string }) {
    return this.certificates.revoke(id, body?.reason);
  }
}
