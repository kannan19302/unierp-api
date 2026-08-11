/**
 * M25 — provider billing ingestion, console-facing surface.
 */
import { Controller, Get, Post, Param, Body, UseGuards } from "@nestjs/common";
import { ApiTags, ApiOperation, ApiBearerAuth } from "@nestjs/swagger";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RbacGuard } from "../../common/guards/rbac.guard";
import { ControlPlaneGuard } from "../../common/guards/control-plane.guard";
import { Permissions } from "../../common/decorators/permissions.decorator";
import { SkipTenantScope } from "../../common/decorators/skip-tenant-scope.decorator";
import { CostIngestionService, type IngestBillingExportInput } from "./cost-ingestion.service";

@ApiTags("platform")
@ApiBearerAuth()
@Controller("platform/v1/cost")
@UseGuards(JwtAuthGuard, RbacGuard, ControlPlaneGuard)
@SkipTenantScope()
export class CostIngestionController {
  constructor(private readonly ingestion: CostIngestionService) {}

  @ApiOperation({ summary: "Ingest a provider's billing export for a period — reconciles to the invoice total to the cent, replaces rather than appends on re-ingestion" })
  @Post("ingest")
  @Permissions("system.cost.ingest")
  async ingest(@Body() body: IngestBillingExportInput) {
    return this.ingestion.ingestBillingExport(body);
  }

  @ApiOperation({ summary: "Get an ingested batch and its line items for a provider/period" })
  @Get(":providerId/:period")
  @Permissions("system.cost.read")
  async getBatch(@Param("providerId") providerId: string, @Param("period") period: string) {
    return this.ingestion.getBatch(providerId, period);
  }
}
