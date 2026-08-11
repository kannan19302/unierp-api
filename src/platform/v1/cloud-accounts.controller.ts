/**
 * M16 — onboards a cloud provider account through the console. The whole
 * point of this endpoint's shape is that onboarding a SECOND, DIFFERENT
 * provider is a different request body, never a different code path — see
 * CloudAccountService's own docs for why.
 */
import { Controller, Get, Post, Body, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RbacGuard } from "../../common/guards/rbac.guard";
import { ControlPlaneGuard } from "../../common/guards/control-plane.guard";
import { SkipTenantScope } from "../../common/decorators/skip-tenant-scope.decorator";
import { Permissions } from "../../common/decorators/permissions.decorator";
import { ApiTags, ApiOperation, ApiBearerAuth } from "@nestjs/swagger";
import { CloudAccountService, type OnboardCloudAccountInput } from "../provider-registry/cloud-account.service";
import { ResourceModelService } from "../resource-model/resource-model.service";

@ApiTags("platform")
@ApiBearerAuth()
@Controller("platform/v1/cloud-accounts")
@UseGuards(JwtAuthGuard, RbacGuard, ControlPlaneGuard)
@SkipTenantScope()
export class CloudAccountsController {
  constructor(
    private readonly cloudAccounts: CloudAccountService,
    private readonly resources: ResourceModelService,
  ) {}

  @ApiOperation({ summary: "List onboarded cloud accounts" })
  @Get()
  @Permissions("system.estate.read")
  async list() {
    return this.resources.searchResources({ kindName: "cloud-account", limit: 100 });
  }

  @ApiOperation({ summary: "Onboard a cloud provider account: registers the provider, binds a secret-ref credential, discovers inventory" })
  @Post()
  @Permissions("system.cloudaccount.onboard")
  async onboard(@Body() body: OnboardCloudAccountInput) {
    return this.cloudAccounts.onboardAccount(body);
  }
}
