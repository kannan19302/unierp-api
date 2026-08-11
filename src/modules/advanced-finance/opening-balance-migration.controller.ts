/**
 * D09 — HTTP surface for the opening-balance migration mechanism proven
 * in services/opening-balance-migration.service.ts.
 */
import { Controller, Post, Get, Body, Query, UseGuards, Req } from "@nestjs/common";
import type { Request } from "express";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RbacGuard } from "../../common/guards/rbac.guard";
import { Permissions } from "../../common/decorators/permissions.decorator";
import { ApiTags, ApiOperation, ApiBearerAuth } from "@nestjs/swagger";
import { OpeningBalanceMigrationService, type OpeningBalanceRow } from "./services/opening-balance-migration.service";

interface AuthReq extends Request {
  user: { tenantId: string; userId: string };
}

interface ImportBody {
  orgId: string;
  rows: OpeningBalanceRow[];
}

@ApiTags("advanced-finance")
@ApiBearerAuth()
@Controller("advanced-finance/opening-balance-migration")
@UseGuards(JwtAuthGuard, RbacGuard)
export class OpeningBalanceMigrationController {
  constructor(private readonly migration: OpeningBalanceMigrationService) {}

  @ApiOperation({ summary: "Import a mapped opening-balance template as a posted journal" })
  @Permissions("finance.account.create")
  @Post("import")
  async importOpeningBalances(@Req() req: AuthReq, @Body() body: ImportBody) {
    return this.migration.importOpeningBalances(req.user.tenantId, body.orgId, body.rows);
  }

  @ApiOperation({ summary: "The downloadable reconciliation statement — source template vs. the resulting trial balance" })
  @Permissions("finance.account.read")
  @Post("reconcile")
  async reconcile(
    @Req() req: AuthReq,
    @Body() body: { orgId: string; rows: OpeningBalanceRow[] },
    @Query("asOfDate") asOfDate?: string,
  ) {
    return this.migration.reconcileOpeningBalances(req.user.tenantId, body.orgId, body.rows, asOfDate ?? new Date().toISOString());
  }
}
