/**
 * M32 — multi-provider staff IdP, console-facing surface.
 */
import { Controller, Get, Post, Body, Param, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";
import { ZodBody } from "../../common/decorators/zod-body.decorator";
import { runWithTenantSession } from "@kannan19302/database";
import { AccessReviewService, type AccessReviewDecision } from "../../common/services/access-review.service";
import { ApiTags, ApiOperation, ApiBearerAuth } from "@nestjs/swagger";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RbacGuard } from "../../common/guards/rbac.guard";
import { ControlPlaneGuard } from "../../common/guards/control-plane.guard";
import { Permissions } from "../../common/decorators/permissions.decorator";
import { SkipTenantScope } from "../../common/decorators/skip-tenant-scope.decorator";
import { StaffIdpService } from "./staff-idp.service";

@ApiTags("platform")
@ApiBearerAuth()
@Controller("platform/v1/staff-idp")
@UseGuards(JwtAuthGuard, RbacGuard, ControlPlaneGuard)
@SkipTenantScope()
export class StaffIdpController {
  constructor(
    private readonly idp: StaffIdpService,
    private readonly accessReviews: AccessReviewService,
  ) {}

  private providerTenantId(req: Request & { user?: { tenantId?: string } }) {
    return req.user?.tenantId ?? "";
  }

  private providerScoped<T>(
    req: Request & { user?: { tenantId?: string; userId?: string } },
    operation: () => Promise<T>,
  ): Promise<T> {
    return runWithTenantSession(
      {
        tenantId: this.providerTenantId(req),
        userId: req.user?.userId ?? "provider-control-plane",
      },
      operation,
    );
  }

  @ApiOperation({ summary: "List provider workforce principals" })
  @Get("principals")
  @Permissions("pcc.identity-governance.access")
  async listPrincipals(@Req() req: Request & { user?: { tenantId?: string } }) {
    return this.idp.listPrincipals(this.providerTenantId(req));
  }

  @ApiOperation({ summary: "List provider workforce groups" })
  @Get("groups")
  @Permissions("pcc.identity-governance.access")
  async listGroups(@Req() req: Request & { user?: { tenantId?: string } }) {
    return this.idp.listGroups(this.providerTenantId(req));
  }

  @ApiOperation({ summary: "List provider roles and permissions" })
  @Get("roles")
  @Permissions("pcc.identity-governance.access")
  async listRoles(@Req() req: Request & { user?: { tenantId?: string } }) {
    return this.idp.listRoles(this.providerTenantId(req));
  }

  @ApiOperation({ summary: "List provider access packages" })
  @Get("access-packages")
  @Permissions("pcc.identity-governance.access")
  async listAccessPackages(@Req() req: Request & { user?: { tenantId?: string } }) {
    return this.idp.listAccessPackages(this.providerTenantId(req));
  }

  @ApiOperation({ summary: "List provider service-principal credentials without secrets" })
  @Get("service-principals")
  @Permissions("pcc.identity-governance.access")
  async listServicePrincipals(@Req() req: Request & { user?: { tenantId?: string } }) {
    return this.idp.listServicePrincipals(this.providerTenantId(req));
  }

  @ApiOperation({ summary: "List provider operator sessions without session secrets" })
  @Get("sessions")
  @Permissions("pcc.identity-governance.access")
  async listSessions(@Req() req: Request & { user?: { tenantId?: string } }) {
    return this.idp.listSessions(this.providerTenantId(req));
  }

  @ApiOperation({ summary: "Get effective provider access and grant provenance" })
  @Get("principals/:principalId/effective-access")
  @Permissions("pcc.identity-governance.access")
  async getEffectiveAccess(
    @Req() req: Request & { user?: { tenantId?: string } },
    @Param("principalId") principalId: string,
  ) {
    return this.idp.getEffectiveAccess(this.providerTenantId(req), principalId);
  }

  @ApiOperation({ summary: "List provider access-review campaigns" })
  @Get("access-reviews")
  @Permissions("pcc.identity-governance.access")
  async listAccessReviews(@Req() req: Request & { user?: { tenantId?: string; userId?: string } }) {
    return this.providerScoped(req, () =>
      this.accessReviews.listCampaigns(this.providerTenantId(req), "PROVIDER"),
    );
  }

  @ApiOperation({ summary: "Get a provider access-review campaign" })
  @Get("access-reviews/:id")
  @Permissions("pcc.identity-governance.access")
  async getAccessReview(@Req() req: Request & { user?: { tenantId?: string; userId?: string } }, @Param("id") id: string) {
    return this.providerScoped(req, () =>
      this.accessReviews.getCampaign(this.providerTenantId(req), "PROVIDER", id),
    );
  }

  @ApiOperation({ summary: "Create a provider access-review campaign" })
  @Post("access-reviews")
  @Permissions("pcc.identity-governance.access")
  async createAccessReview(
    @Req() req: Request & { user?: { tenantId?: string; userId?: string } },
    @ZodBody(z.object({ name: z.string().trim().min(1).max(200), description: z.string().max(4000).optional(), dueAt: z.string().datetime().optional(), reviewerStrategy: z.record(z.unknown()).optional() })) body: { name: string; description?: string; dueAt?: string; reviewerStrategy?: Record<string, unknown> },
  ) {
    return this.providerScoped(req, () =>
      this.accessReviews.createCampaign(this.providerTenantId(req), "PROVIDER", req.user?.userId ?? "provider-control-plane", body),
    );
  }

  @ApiOperation({ summary: "Launch a provider access-review campaign" })
  @Post("access-reviews/:id/launch")
  @Permissions("pcc.identity-governance.access")
  async launchAccessReview(@Req() req: Request & { user?: { tenantId?: string; userId?: string } }, @Param("id") id: string) {
    return this.providerScoped(req, () =>
      this.accessReviews.launchCampaign(this.providerTenantId(req), "PROVIDER", id),
    );
  }

  @ApiOperation({ summary: "Record a provider access-review decision" })
  @Post("access-reviews/:id/items/:itemId/decision")
  @Permissions("pcc.identity-governance.access")
  async decideAccessReviewItem(
    @Req() req: Request & { user?: { tenantId?: string; userId?: string } },
    @Param("id") id: string,
    @Param("itemId") itemId: string,
    @ZodBody(z.object({ decision: z.enum(["CERTIFIED", "REVOKE", "EXCEPTION"]), reason: z.string().max(4000).optional() })) body: { decision: AccessReviewDecision; reason?: string },
  ) {
    return this.providerScoped(req, () =>
      this.accessReviews.decideItem(this.providerTenantId(req), "PROVIDER", id, itemId, req.user?.userId ?? "provider-control-plane", body.decision, body.reason),
    );
  }

  @ApiOperation({ summary: "Complete a provider access-review campaign" })
  @Post("access-reviews/:id/complete")
  @Permissions("pcc.identity-governance.access")
  async completeAccessReview(@Req() req: Request & { user?: { tenantId?: string; userId?: string } }, @Param("id") id: string) {
    return this.providerScoped(req, () =>
      this.accessReviews.completeCampaign(this.providerTenantId(req), "PROVIDER", id),
    );
  }

  @ApiOperation({ summary: "Authenticate a staff operator through whichever registered IdP M06 routes to" })
  @Post("authenticate")
  @Permissions("system.staffidp.manage")
  async authenticate(@Body() body: { operatorId: string; nameId: string }) {
    return this.idp.authenticateStaff(body.operatorId, body.nameId);
  }
}
