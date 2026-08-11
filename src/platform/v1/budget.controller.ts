/**
 * M29 — budgets, console-facing surface.
 */
import { Controller, Post, Body, UseGuards } from "@nestjs/common";
import { ApiTags, ApiOperation, ApiBearerAuth } from "@nestjs/swagger";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RbacGuard } from "../../common/guards/rbac.guard";
import { ControlPlaneGuard } from "../../common/guards/control-plane.guard";
import { Permissions } from "../../common/decorators/permissions.decorator";
import { SkipTenantScope } from "../../common/decorators/skip-tenant-scope.decorator";
import { BudgetService } from "./budget.service";

@ApiTags("platform")
@ApiBearerAuth()
@Controller("platform/v1/budgets")
@UseGuards(JwtAuthGuard, RbacGuard, ControlPlaneGuard)
@SkipTenantScope()
export class BudgetController {
  constructor(private readonly budgets: BudgetService) {}

  @ApiOperation({ summary: "Create or update a budget policy for a tenant/period, with an optional enforcement plan" })
  @Post()
  @Permissions("system.budget.manage")
  async createBudget(
    @Body() body: { tenantId: string; period: string; thresholdAmount: string; enforcement?: { resourceId: string; desiredState: Record<string, unknown> } },
  ) {
    return this.budgets.createBudget(body.tenantId, body.period, body.thresholdAmount, body.enforcement);
  }

  @ApiOperation({ summary: "Check a tenant's actual spend against its budget — alerts and, where configured, enforces through the pipeline" })
  @Post("check")
  @Permissions("system.budget.read")
  async check(@Body() body: { tenantId: string; period: string; actualSpend: string }) {
    return this.budgets.checkAndEnforce(body.tenantId, body.period, body.actualSpend);
  }
}
