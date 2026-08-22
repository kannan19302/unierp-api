import { Controller, Delete, Get, Param, Post, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import { z } from "zod";
import { Permissions } from "../../common/decorators/permissions.decorator";
import { ZodBody } from "../../common/decorators/zod-body.decorator";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RbacGuard } from "../../common/guards/rbac.guard";
import { RequireIdempotencyKey } from "../../common/idempotency/require-idempotency-key.decorator";
import { DeveloperPackagesService } from "./developer-packages.service";
import { DeveloperAuthorizationService } from "./developer-authorization.service";

interface AuthenticatedRequest extends Request {
  user: { tenantId: string; userId: string; email: string; roles: string[] };
}

const packageSchema = z.object({
  namespace: z.string().min(3).max(160),
  name: z.string().min(1).max(120),
  description: z.string().max(2000).optional(),
  editability: z.enum(["MANAGED", "UNLOCKED", "INTERNAL"]),
});
const versionSchema = z.object({
  version: z.string().min(5).max(64),
  items: z.array(z.object({ artifactId: z.string().min(1), revision: z.number().int().positive(), exportName: z.string().min(1).max(160) })).min(1),
  licenseExpression: z.string().min(2).max(240).optional(),
  sbomDigest: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
  vulnerabilityStatus: z.enum(["UNKNOWN", "CLEAN", "ADVISORY", "BLOCKED"]).default("UNKNOWN"),
  vulnerabilityReport: z.array(z.object({ id: z.string().min(1).max(240), severity: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]), summary: z.string().min(1).max(1000) })).default([]),
});
const installSchema = z.object({
  packageVersionId: z.string().min(1),
  mode: z.enum(["LINKED", "PINNED", "FORKED", "EMBEDDED"]).default("PINNED"),
  requestedRange: z.string().max(64).optional(),
  resourceMappings: z.record(z.unknown()).default({}),
  capabilityGrants: z.array(z.unknown()).default([]),
});
const signingKeySchema = z.object({
  keyId: z.string().min(8).max(160),
  publicKey: z.string().min(32),
  label: z.string().min(1).max(160),
});
const publishSchema = z.object({
  keyId: z.string().min(8).max(160),
  signature: z.string().min(32),
});
const upgradeSchema = z.object({
  targetPackageVersionId: z.string().min(1),
  approvedBreaking: z.boolean().default(false),
});

@ApiTags("developer-platform-packages")
@ApiBearerAuth()
@Controller("dev")
@UseGuards(JwtAuthGuard, RbacGuard)
export class DeveloperPackagesController {
  constructor(private readonly packages: DeveloperPackagesService, private readonly authorization: DeveloperAuthorizationService) {}

  @Get("packages")
  @Permissions("builder.read")
  list(@Req() req: AuthenticatedRequest) {
    return this.packages.list(req.user.tenantId);
  }

  @Post("packages")
  @Permissions("builder.write")
  @RequireIdempotencyKey()
  create(@Req() req: AuthenticatedRequest, @ZodBody(packageSchema) body: z.infer<typeof packageSchema>) {
    return this.packages.createPackage({ ...body, tenantId: req.user.tenantId, createdBy: req.user.userId });
  }

  @Post("signing-keys")
  @Permissions("builder.manage")
  @RequireIdempotencyKey()
  registerKey(
    @Req() req: AuthenticatedRequest,
    @ZodBody(signingKeySchema) body: z.infer<typeof signingKeySchema>,
  ) {
    return this.packages.registerSigningKey({ ...body, tenantId: req.user.tenantId, createdBy: req.user.userId });
  }

  @Get("signing-keys")
  @Permissions("builder.manage")
  listSigningKeys(@Req() req: AuthenticatedRequest) {
    return this.packages.listSigningKeys(req.user.tenantId);
  }

  @Post("signing-keys/:keyId/revoke")
  @Permissions("builder.manage")
  @RequireIdempotencyKey()
  @ApiOperation({ summary: "Revoke a signing key; releases signed by it fail closed at runtime" })
  revokeSigningKey(@Req() req: AuthenticatedRequest, @Param("keyId") keyId: string) {
    return this.packages.revokeSigningKey(req.user.tenantId, keyId);
  }

  @Post("packages/:packageId/versions")
  @Permissions("builder.write")
  @RequireIdempotencyKey()
  @ApiOperation({ summary: "Create an immutable package version from exact artifact revisions" })
  version(
    @Req() req: AuthenticatedRequest,
    @Param("packageId") packageId: string,
    @ZodBody(versionSchema) body: z.infer<typeof versionSchema>,
  ) {
    return this.packages.createVersion({ ...body, tenantId: req.user.tenantId, packageId, publishedBy: req.user.userId });
  }

  @Post("packages/:packageId/versions/:packageVersionId/publish")
  @Permissions("builder.write")
  @RequireIdempotencyKey()
  @ApiOperation({ summary: "Verify and publish an immutable signed package version" })
  publish(
    @Req() req: AuthenticatedRequest,
    @Param("packageId") packageId: string,
    @Param("packageVersionId") packageVersionId: string,
    @ZodBody(publishSchema) body: z.infer<typeof publishSchema>,
  ) {
    return this.packages.publishVersion({
      ...body,
      tenantId: req.user.tenantId,
      packageId,
      packageVersionId,
      publishedBy: req.user.userId,
    });
  }

  @Post("packages/:packageId/versions/:packageVersionId/certify")
  @Permissions("builder.manage")
  @RequireIdempotencyKey()
  @ApiOperation({ summary: "Run package certification before marketplace promotion" })
  certify(@Req() req: AuthenticatedRequest, @Param("packageId") packageId: string, @Param("packageVersionId") packageVersionId: string) {
    return this.packages.certifyVersion({ tenantId: req.user.tenantId, packageId, packageVersionId, certifiedBy: req.user.userId });
  }

  @Post("packages/:packageId/versions/:packageVersionId/promote-marketplace")
  @Permissions("builder.manage")
  @RequireIdempotencyKey()
  @ApiOperation({ summary: "Promote a certified signed package version to marketplace visibility" })
  promote(@Req() req: AuthenticatedRequest, @Param("packageId") packageId: string, @Param("packageVersionId") packageVersionId: string) {
    return this.packages.promoteToMarketplace({ tenantId: req.user.tenantId, packageId, packageVersionId });
  }

  @Post("packages/:packageId/suspend")
  @Permissions("builder.manage")
  @RequireIdempotencyKey()
  @ApiOperation({ summary: "Emergency kill switch: stop package use and runtime resolution" })
  suspend(@Req() req: AuthenticatedRequest, @Param("packageId") packageId: string) {
    return this.packages.suspendPackage(req.user.tenantId, packageId);
  }

  @Post("packages/:packageId/reinstate")
  @Permissions("builder.manage")
  @RequireIdempotencyKey()
  @ApiOperation({ summary: "Restore a suspended package after remediation" })
  reinstate(@Req() req: AuthenticatedRequest, @Param("packageId") packageId: string) {
    return this.packages.reinstatePackage(req.user.tenantId, packageId);
  }

  @Post("projects/:projectId/installations")
  @Permissions("builder.write")
  @RequireIdempotencyKey()
  @ApiOperation({ summary: "Install a signed immutable package version into a project" })
  async install(
    @Req() req: AuthenticatedRequest,
    @Param("projectId") projectId: string,
    @ZodBody(installSchema) body: z.infer<typeof installSchema>,
  ) {
    await this.authorization.assertProjectAction(req.user.tenantId, projectId, req.user, "AUTHOR");
    return this.packages.install({ ...body, tenantId: req.user.tenantId, projectId, installedBy: req.user.userId });
  }

  @Get("projects/:projectId/installations")
  @Permissions("builder.read")
  async installations(@Req() req: AuthenticatedRequest, @Param("projectId") projectId: string) {
    await this.authorization.assertProjectAction(req.user.tenantId, projectId, req.user, "AUTHOR");
    return this.packages.listInstallations(req.user.tenantId, projectId);
  }

  @Post("projects/:projectId/installations/:installationId/upgrade-impact")
  @Permissions("builder.read")
  async impact(
    @Req() req: AuthenticatedRequest,
    @Param("projectId") projectId: string,
    @Param("installationId") installationId: string,
    @ZodBody(upgradeSchema.pick({ targetPackageVersionId: true })) body: { targetPackageVersionId: string },
  ) {
    await this.authorization.assertProjectAction(req.user.tenantId, projectId, req.user, "AUTHOR");
    return this.packages.upgradeImpact({ ...body, tenantId: req.user.tenantId, projectId, installationId });
  }

  @Post("projects/:projectId/installations/:installationId/upgrade")
  @Permissions("builder.write")
  @RequireIdempotencyKey()
  async upgrade(
    @Req() req: AuthenticatedRequest,
    @Param("projectId") projectId: string,
    @Param("installationId") installationId: string,
    @ZodBody(upgradeSchema) body: z.infer<typeof upgradeSchema>,
  ) {
    await this.authorization.assertProjectAction(req.user.tenantId, projectId, req.user, "AUTHOR");
    return this.packages.upgrade({ ...body, tenantId: req.user.tenantId, projectId, installationId });
  }

  @Delete("projects/:projectId/installations/:installationId")
  @Permissions("builder.write")
  @RequireIdempotencyKey()
  async remove(
    @Req() req: AuthenticatedRequest,
    @Param("projectId") projectId: string,
    @Param("installationId") installationId: string,
  ) {
    await this.authorization.assertProjectAction(req.user.tenantId, projectId, req.user, "AUTHOR");
    return this.packages.remove(req.user.tenantId, projectId, installationId);
  }
}
