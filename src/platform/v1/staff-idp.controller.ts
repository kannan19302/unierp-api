import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
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
import {
  createStaffPrincipalSchema,
  updateStaffPrincipalSchema,
  createRoleSchema,
  updateRoleSchema,
  type CreateStaffPrincipalInput,
  type UpdateStaffPrincipalInput,
  type StaffPrincipalQueryInput,
  type CreateRoleInput,
  type UpdateRoleInput,
  type RoleQueryInput,
} from "./dto/staff-crud.dto";

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

  private auditCtx(req: Request & { user?: { userId?: string; realm?: string } }) {
    return {
      actorId: req.user?.userId ?? "provider-admin",
      actorRole: req.user?.realm ?? "SUPER_ADMIN",
      ipAddress: req.ip,
      correlationId: (req.headers["x-correlation-id"] as string) || undefined,
    };
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
  async listPrincipals(
    @Req() req: Request & { user?: { tenantId?: string } },
    @Query() query?: StaffPrincipalQueryInput,
  ) {
    return this.idp.listPrincipals(this.providerTenantId(req), query);
  }

  @ApiOperation({ summary: "Get provider workforce principal by id" })
  @Get("principals/:id")
  @Permissions("pcc.identity-governance.access")
  async getPrincipal(
    @Req() req: Request & { user?: { tenantId?: string } },
    @Param("id") id: string,
  ) {
    return this.idp.getPrincipal(this.providerTenantId(req), id);
  }

  @ApiOperation({ summary: "Create a provider workforce principal" })
  @Post("principals")
  @Permissions("pcc.identity-governance.access")
  async createPrincipal(
    @Req() req: Request & { user?: { tenantId?: string; userId?: string; realm?: string } },
    @ZodBody(createStaffPrincipalSchema) body: CreateStaffPrincipalInput,
  ) {
    return this.idp.createPrincipal(this.providerTenantId(req), body, this.auditCtx(req));
  }

  @ApiOperation({ summary: "Update a provider workforce principal" })
  @Patch("principals/:id")
  @Permissions("pcc.identity-governance.access")
  async updatePrincipal(
    @Req() req: Request & { user?: { tenantId?: string; userId?: string; realm?: string } },
    @Param("id") id: string,
    @ZodBody(updateStaffPrincipalSchema) body: UpdateStaffPrincipalInput,
  ) {
    return this.idp.updatePrincipal(this.providerTenantId(req), id, body, this.auditCtx(req));
  }

  @ApiOperation({ summary: "Deactivate/delete a provider workforce principal" })
  @Delete("principals/:id")
  @Permissions("pcc.identity-governance.access")
  async deletePrincipal(
    @Req() req: Request & { user?: { tenantId?: string; userId?: string; realm?: string } },
    @Param("id") id: string,
  ) {
    return this.idp.deletePrincipal(this.providerTenantId(req), id, this.auditCtx(req));
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
  async listRoles(
    @Req() req: Request & { user?: { tenantId?: string } },
    @Query() query?: RoleQueryInput,
  ) {
    return this.idp.listRoles(this.providerTenantId(req), query);
  }

  @ApiOperation({ summary: "Get provider role by ID" })
  @Get("roles/:id")
  @Permissions("pcc.identity-governance.access")
  async getRole(
    @Req() req: Request & { user?: { tenantId?: string } },
    @Param("id") id: string,
  ) {
    return this.idp.getRole(this.providerTenantId(req), id);
  }

  @ApiOperation({ summary: "Create a provider role" })
  @Post("roles")
  @Permissions("pcc.identity-governance.access")
  async createRole(
    @Req() req: Request & { user?: { tenantId?: string; userId?: string; realm?: string } },
    @ZodBody(createRoleSchema) body: CreateRoleInput,
  ) {
    return this.idp.createRole(this.providerTenantId(req), body, this.auditCtx(req));
  }

  @ApiOperation({ summary: "Update a provider role" })
  @Patch("roles/:id")
  @Permissions("pcc.identity-governance.access")
  async updateRole(
    @Req() req: Request & { user?: { tenantId?: string; userId?: string; realm?: string } },
    @Param("id") id: string,
    @ZodBody(updateRoleSchema) body: UpdateRoleInput,
  ) {
    return this.idp.updateRole(this.providerTenantId(req), id, body, this.auditCtx(req));
  }

  @ApiOperation({ summary: "Delete a provider role" })
  @Delete("roles/:id")
  @Permissions("pcc.identity-governance.access")
  async deleteRole(
    @Req() req: Request & { user?: { tenantId?: string; userId?: string; realm?: string } },
    @Param("id") id: string,
  ) {
    return this.idp.deleteRole(this.providerTenantId(req), id, this.auditCtx(req));
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

  @ApiOperation({ summary: "Revoke a provider operator session" })
  @Delete("sessions/:id")
  @Permissions("pcc.identity-governance.access")
  async revokeSession(
    @Req() req: Request & { user?: { tenantId?: string; userId?: string; realm?: string } },
    @Param("id") id: string,
  ) {
    return this.idp.revokeSession(this.providerTenantId(req), id, this.auditCtx(req));
  }

  @ApiOperation({ summary: "Revoke all provider operator sessions" })
  @Post("sessions/revoke-all")
  @Permissions("pcc.identity-governance.access")
  async revokeAllSessions(
    @Req() req: Request & { user?: { tenantId?: string; userId?: string; realm?: string } },
    @Body() body?: { userId?: string },
  ) {
    return this.idp.revokeAllSessions(this.providerTenantId(req), body?.userId, this.auditCtx(req));
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
