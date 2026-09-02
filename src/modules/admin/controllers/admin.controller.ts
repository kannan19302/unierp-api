import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  UseInterceptors,
  Req,
} from "@nestjs/common";
import { z } from "zod";
import { ZodBody } from "../../../common/decorators/zod-body.decorator";
import { Request } from "express";
import { AdminService } from "../services/admin.service";
import { AccessReviewService, type AccessReviewDecision } from "../../../common/services/access-review.service";
import { JwtAuthGuard } from "../../../common/guards/jwt-auth.guard";
import { RbacGuard } from "../../../common/guards/rbac.guard";
import { TenantInterceptor } from "../../../common/guards/tenant.interceptor";
import { Permissions } from "../../../common/decorators/permissions.decorator";
import { TrackChanges } from "../../../common/decorators/track-changes.decorator";
import { ChangeHistoryInterceptor } from "../../../common/interceptors/change-history.interceptor";
import { ZodValidationPipe } from "../../../common/pipes/zod-validation.pipe";
import {
  createUserSchema,
  updateUserSchema,
  CreateUserInput,
  UpdateUserInput,
} from "@kannan19302/shared";
import {
  createAccessPackageSchema,
  updateAccessPackageSchema,
  CreateAccessPackageInput,
  UpdateAccessPackageInput,
  offboardUserSchema,
  OffboardUserInput,
  transferOwnershipSchema,
  TransferOwnershipInput,
  bulkUserActionSchema,
  BulkUserActionInput,
} from "../services/admin.schemas";
import { ApiTags, ApiOperation, ApiBearerAuth } from "@nestjs/swagger";

interface AuthenticatedRequest extends Request {
  user: {
    tenantId: string;
    userId: string;
    email: string;
    firstName: string;
    lastName: string;
    roles: string[];
  };
}

@ApiTags("admin")
@ApiBearerAuth()
@Controller("admin")
@UseGuards(JwtAuthGuard, RbacGuard)
@UseInterceptors(TenantInterceptor)
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    private readonly accessReviews: AccessReviewService,
  ) {}

  @ApiOperation({ summary: "Get users" })
  @Get("users")
  @Permissions("admin.user.read")
  async getUsers(@Req() req: AuthenticatedRequest): Promise<unknown> {
    return this.adminService.getUsers(req.user.tenantId);
  }

  @ApiOperation({ summary: "Get a user's effective access and grant sources" })
  @Get("users/:id/effective-access")
  @Permissions("occ.access-governance.access")
  async getEffectiveAccess(
    @Req() req: AuthenticatedRequest,
    @Param("id") userId: string,
  ): Promise<unknown> {
    return this.adminService.getEffectiveAccess(req.user.tenantId, userId);
  }

  @ApiOperation({ summary: "List organization access-review campaigns" })
  @Get("access-reviews")
  @Permissions("occ.access-governance.access")
  async listAccessReviews(@Req() req: AuthenticatedRequest): Promise<unknown> {
    return this.accessReviews.listCampaigns(req.user.tenantId, "ORGANIZATION");
  }

  @ApiOperation({ summary: "Get an organization access-review campaign" })
  @Get("access-reviews/:id")
  @Permissions("occ.access-governance.access")
  async getAccessReview(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
  ): Promise<unknown> {
    return this.accessReviews.getCampaign(req.user.tenantId, "ORGANIZATION", id);
  }

  @ApiOperation({ summary: "Create an organization access-review campaign" })
  @Post("access-reviews")
  @Permissions("occ.access-governance.access")
  async createAccessReview(
    @Req() req: AuthenticatedRequest,
    @ZodBody(z.object({ name: z.string().trim().min(1).max(200), description: z.string().max(4000).optional(), dueAt: z.string().datetime().optional(), reviewerStrategy: z.record(z.unknown()).optional() }))
    body: { name: string; description?: string; dueAt?: string; reviewerStrategy?: Record<string, unknown> },
  ): Promise<unknown> {
    return this.accessReviews.createCampaign(req.user.tenantId, "ORGANIZATION", req.user.userId, body);
  }

  @ApiOperation({ summary: "Launch an organization access-review campaign" })
  @Post("access-reviews/:id/launch")
  @Permissions("occ.access-governance.access")
  async launchAccessReview(@Req() req: AuthenticatedRequest, @Param("id") id: string): Promise<unknown> {
    return this.accessReviews.launchCampaign(req.user.tenantId, "ORGANIZATION", id);
  }

  @ApiOperation({ summary: "Record an access-review decision" })
  @Post("access-reviews/:id/items/:itemId/decision")
  @Permissions("occ.access-governance.access")
  async decideAccessReviewItem(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Param("itemId") itemId: string,
    @ZodBody(z.object({ decision: z.enum(["CERTIFIED", "REVOKE", "EXCEPTION"]), reason: z.string().max(4000).optional() }))
    body: { decision: AccessReviewDecision; reason?: string },
  ): Promise<unknown> {
    return this.accessReviews.decideItem(req.user.tenantId, "ORGANIZATION", id, itemId, req.user.userId, body.decision, body.reason);
  }

  @ApiOperation({ summary: "Complete an organization access-review campaign" })
  @Post("access-reviews/:id/complete")
  @Permissions("occ.access-governance.access")
  async completeAccessReview(@Req() req: AuthenticatedRequest, @Param("id") id: string): Promise<unknown> {
    return this.accessReviews.completeCampaign(req.user.tenantId, "ORGANIZATION", id);
  }

  @ApiOperation({ summary: "Create user" })
  @Post("users")
  @Permissions("admin.user.create")
  async createUser(
    @Req() req: AuthenticatedRequest,
    @Body(new ZodValidationPipe(createUserSchema)) dto: CreateUserInput,
  ): Promise<unknown> {
    return this.adminService.createUser(req.user.tenantId, dto);
  }

  @ApiOperation({ summary: "Update user" })
  @Patch("users/:id")
  @Permissions("admin.user.update")
  async updateUser(
    @Req() req: AuthenticatedRequest,
    @Param("id") userId: string,
    @Body(new ZodValidationPipe(updateUserSchema)) dto: UpdateUserInput,
  ): Promise<unknown> {
    return this.adminService.updateUser(req.user.tenantId, userId, dto);
  }

  @ApiOperation({ summary: "Delete user / Revoke invitation" })
  @Delete("users/:id")
  @Permissions("admin.user.delete")
  async deleteUser(
    @Req() req: AuthenticatedRequest,
    @Param("id") userId: string,
  ): Promise<unknown> {
    return this.adminService.deleteUser(req.user.tenantId, userId);
  }

  @ApiOperation({ summary: "Activate user" })
  @Post("users/:id/activate")
  @Permissions("admin.user.update")
  async activateUser(
    @Req() req: AuthenticatedRequest,
    @Param("id") userId: string,
  ): Promise<unknown> {
    return this.adminService.activateUser(req.user.tenantId, userId);
  }

  @ApiOperation({ summary: "Suspend user" })
  @Post("users/:id/suspend")
  @Permissions("admin.user.update")
  async suspendUser(
    @Req() req: AuthenticatedRequest,
    @Param("id") userId: string,
  ): Promise<unknown> {
    return this.adminService.suspendUser(req.user.tenantId, userId);
  }

  @ApiOperation({ summary: "Transfer ownership" })
  @Post("users/:id/transfer-ownership")
  @Permissions("admin.user.manage-roles")
  async transferOwnership(
    @Req() req: AuthenticatedRequest,
    @Param("id") userId: string,
    @Body(new ZodValidationPipe(transferOwnershipSchema)) dto: TransferOwnershipInput,
  ): Promise<unknown> {
    return this.adminService.transferOwnership(req.user.tenantId, userId, dto.toUserId);
  }

  @ApiOperation({ summary: "Offboard user" })
  @Post("users/:id/offboard")
  @Permissions("admin.user.delete")
  async offboardUser(
    @Req() req: AuthenticatedRequest,
    @Param("id") userId: string,
    @Body(new ZodValidationPipe(offboardUserSchema)) dto: OffboardUserInput,
  ): Promise<unknown> {
    return this.adminService.offboardUser(req.user.tenantId, userId, dto.reassignToUserId);
  }

  @ApiOperation({ summary: "Bulk user operations" })
  @Post("users/bulk")
  @Permissions("admin.user.update")
  async bulkUserOperations(
    @Req() req: AuthenticatedRequest,
    @Body(new ZodValidationPipe(bulkUserActionSchema)) dto: BulkUserActionInput,
  ): Promise<unknown> {
    return this.adminService.bulkUserOperations(req.user.tenantId, dto.action, dto.userIds, dto.targetUserId);
  }

  @ApiOperation({ summary: "Get team overview" })
  @Get("users/team-overview")
  @Permissions("admin.user.read")
  async getTeamOverview(@Req() req: AuthenticatedRequest): Promise<unknown> {
    return this.adminService.getTeamOverview(req.user.tenantId);
  }

  @ApiOperation({ summary: "Generate invite link" })
  @Post("users/invite-link")
  @Permissions("admin.user.create")
  async generateInviteLink(@Req() req: AuthenticatedRequest): Promise<unknown> {
    return this.adminService.generateInviteLink(req.user.tenantId);
  }

  @ApiOperation({ summary: "Resend invitation" })
  @Post("users/invitations/:id/resend")
  @Permissions("admin.user.update")
  async resendInvitation(
    @Req() req: AuthenticatedRequest,
    @Param("id") userId: string,
  ): Promise<unknown> {
    return this.adminService.resendInvitation(req.user.tenantId, userId);
  }

  @ApiOperation({ summary: "Get roles" })
  @Get("roles")
  @Permissions("admin.role.read")
  async getRoles(@Req() req: AuthenticatedRequest): Promise<unknown> {
    return this.adminService.getRoles(req.user.tenantId);
  }

  @ApiOperation({ summary: "Create role" })
  @Post("roles")
  @Permissions("admin.role.create")
  async createRole(
    @Req() req: AuthenticatedRequest,
    @ZodBody(z.object({
      name: z.string().min(1).max(100),
      description: z.string().max(500).optional(),
      permissions: z.array(z.string()).optional(),
    })) body: { name: string; description?: string; permissions?: string[] },
  ): Promise<unknown> {
    return this.adminService.createRole(req.user.tenantId, body);
  }

  @ApiOperation({ summary: "Update role" })
  @Patch("roles/:id")
  @Permissions("admin.role.update")
  async updateRole(
    @Req() req: AuthenticatedRequest,
    @Param("id") roleId: string,
    @ZodBody(z.object({
      name: z.string().min(1).max(100).optional(),
      description: z.string().max(500).optional(),
      permissions: z.array(z.string()).optional(),
    })) body: { name?: string; description?: string; permissions?: string[] },
  ): Promise<unknown> {
    return this.adminService.updateRole(req.user.tenantId, roleId, body);
  }

  @ApiOperation({ summary: "Delete role" })
  @Delete("roles/:id")
  @Permissions("admin.role.delete")
  async deleteRole(
    @Req() req: AuthenticatedRequest,
    @Param("id") roleId: string,
  ): Promise<unknown> {
    return this.adminService.deleteRole(req.user.tenantId, roleId);
  }

  @ApiOperation({ summary: "Get settings" })
  @Get("settings")
  @Permissions("admin.setting.read")
  async getSettings(@Req() req: AuthenticatedRequest): Promise<unknown> {
    return this.adminService.getSettings(req.user.tenantId);
  }

  @ApiOperation({ summary: "Update settings" })
  @Patch("settings")
  @Permissions("admin.setting.update")
  async updateSettings(
    @Req() req: AuthenticatedRequest,
    @ZodBody(z.any()) body: Record<string, unknown>,
  ): Promise<unknown> {
    const validationPipe = new ZodValidationPipe(
      require("@kannan19302/shared").updateAdminSettingsSchema,
    );
    const dto = validationPipe.transform(body, {
      type: "body",
      metatype: Object,
    });
    return this.adminService.updateSettings(req.user.tenantId, dto);
  }

  // ── Demo Data ──

  @ApiOperation({ summary: "Get demo status" })
  @Get("demo/status")
  @Permissions("admin.setting.read")
  async getDemoStatus(@Req() req: AuthenticatedRequest): Promise<unknown> {
    return this.adminService.getDemoStatus(req.user.tenantId);
  }

  @ApiOperation({ summary: "Load demo data" })
  @Post("demo/load")
  @Permissions("admin.demo.manage")
  async loadDemoData(@Req() req: AuthenticatedRequest): Promise<unknown> {
    return this.adminService.loadDemoData(req.user.tenantId);
  }

  @ApiOperation({ summary: "Remove demo data" })
  @Delete("demo/remove")
  @Permissions("admin.demo.manage")
  async removeDemoData(@Req() req: AuthenticatedRequest): Promise<unknown> {
    return this.adminService.removeDemoData(req.user.tenantId);
  }

  @ApiOperation({ summary: "Remove demo data for module" })
  @Delete("demo/remove/:module")
  @Permissions("admin.demo.manage")
  async removeDemoDataForModule(
    @Req() req: AuthenticatedRequest,
    @Param("module") module: string,
  ): Promise<unknown> {
    return this.adminService.removeDemoData(req.user.tenantId, module);
  }

  // ── Access Packages ──

  @ApiOperation({ summary: "Get access packages" })
  @Get("access-packages")
  @Permissions("admin.access-package.read")
  async getAccessPackages(@Req() req: AuthenticatedRequest): Promise<unknown> {
    return this.adminService.getAccessPackages(req.user.tenantId);
  }

  @ApiOperation({ summary: "Create access package" })
  @Post("access-packages")
  @Permissions("admin.access-package.create")
  async createAccessPackage(
    @Req() req: AuthenticatedRequest,
    @Body(new ZodValidationPipe(createAccessPackageSchema))
    dto: CreateAccessPackageInput,
  ): Promise<unknown> {
    return this.adminService.createAccessPackage(req.user.tenantId, dto);
  }

  @ApiOperation({ summary: "Update access package" })
  @Patch("access-packages/:id")
  @Permissions("admin.access-package.update")
  @UseInterceptors(ChangeHistoryInterceptor)
  @TrackChanges("AccessPackage")
  async updateAccessPackage(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateAccessPackageSchema))
    dto: UpdateAccessPackageInput,
  ): Promise<unknown> {
    return this.adminService.updateAccessPackage(req.user.tenantId, id, dto);
  }

  @ApiOperation({ summary: "Delete access package" })
  @Delete("access-packages/:id")
  @Permissions("admin.access-package.delete")
  async deleteAccessPackage(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
  ): Promise<unknown> {
    return this.adminService.deleteAccessPackage(req.user.tenantId, id);
  }

  @ApiOperation({ summary: "Assign access package to role" })
  @Post("access-packages/:id/assign-role")
  @Permissions("admin.access-package.update")
  async assignAccessPackageToRole(
    @Req() req: AuthenticatedRequest,
    @Param("id") accessPackageId: string,
    @Body("roleId") roleId: string,
  ): Promise<unknown> {
    return this.adminService.assignAccessPackageToRole(
      req.user.tenantId,
      accessPackageId,
      roleId,
    );
  }

  @ApiOperation({ summary: "Unassign access package from role" })
  @Delete("access-packages/:id/unassign-role/:roleId")
  @Permissions("admin.access-package.update")
  async unassignAccessPackageFromRole(
    @Req() req: AuthenticatedRequest,
    @Param("id") accessPackageId: string,
    @Param("roleId") roleId: string,
  ): Promise<unknown> {
    return this.adminService.unassignAccessPackageFromRole(
      req.user.tenantId,
      accessPackageId,
      roleId,
    );
  }

  // ── User Groups ──

  @ApiOperation({ summary: "Get groups" })
  @Get("groups")
  @Permissions("admin.user-group.read")
  async getGroups(@Req() req: AuthenticatedRequest): Promise<unknown> {
    return this.adminService.getGroups(req.user.tenantId);
  }

  @ApiOperation({ summary: "Create group" })
  @Post("groups")
  @Permissions("admin.user-group.create")
  async createGroup(
    @Req() req: AuthenticatedRequest,
    @ZodBody(z.any())
    body: { name: string; description?: string; isActive?: boolean },
  ): Promise<unknown> {
    return this.adminService.createGroup(req.user.tenantId, body);
  }

  @ApiOperation({ summary: "Update group" })
  @Patch("groups/:id")
  @Permissions("admin.user-group.update")
  async updateGroup(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @ZodBody(z.any())
    body: { name?: string; description?: string; isActive?: boolean },
  ): Promise<unknown> {
    return this.adminService.updateGroup(req.user.tenantId, id, body);
  }

  @ApiOperation({ summary: "Delete group" })
  @Delete("groups/:id")
  @Permissions("admin.user-group.delete")
  async deleteGroup(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
  ): Promise<unknown> {
    return this.adminService.deleteGroup(req.user.tenantId, id);
  }

  @ApiOperation({ summary: "Get group members" })
  @Get("groups/:id/members")
  @Permissions("admin.user-group.read")
  async getGroupMembers(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
  ): Promise<unknown> {
    return this.adminService.getGroupMembers(req.user.tenantId, id);
  }

  @ApiOperation({ summary: "Add group members" })
  @Post("groups/:id/members")
  @Permissions("admin.user-group.update")
  async addGroupMembers(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Body("userIds") userIds: string[],
  ): Promise<unknown> {
    return this.adminService.addGroupMembers(req.user.tenantId, id, userIds);
  }

  @ApiOperation({ summary: "Remove group member" })
  @Delete("groups/:id/members/:userId")
  @Permissions("admin.user-group.update")
  async removeGroupMember(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Param("userId") userId: string,
  ): Promise<unknown> {
    return this.adminService.removeGroupMember(req.user.tenantId, id, userId);
  }
}
