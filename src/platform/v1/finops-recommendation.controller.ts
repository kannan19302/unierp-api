/**
 * M31 — FinOps recommendations, console-facing surface.
 */
import { Controller, Post, Param, Body, UseGuards } from "@nestjs/common";
import { ApiTags, ApiOperation, ApiBearerAuth } from "@nestjs/swagger";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RbacGuard } from "../../common/guards/rbac.guard";
import { ControlPlaneGuard } from "../../common/guards/control-plane.guard";
import { Permissions } from "../../common/decorators/permissions.decorator";
import { SkipTenantScope } from "../../common/decorators/skip-tenant-scope.decorator";
import { FinOpsRecommendationService, type RecommendationKind } from "./finops-recommendation.service";

@ApiTags("platform")
@ApiBearerAuth()
@Controller("platform/v1/finops")
@UseGuards(JwtAuthGuard, RbacGuard, ControlPlaneGuard)
@SkipTenantScope()
export class FinOpsRecommendationController {
  constructor(private readonly finops: FinOpsRecommendationService) {}

  @ApiOperation({ summary: "Generate a recommendation, with its predicted saving sourced from M25's real ingested prices" })
  @Post("recommendations")
  @Permissions("system.finops.read")
  async generate(
    @Body() body: { resourceId: string; kind: RecommendationKind; savingFraction: number; recommendedDesiredState: Record<string, unknown> },
  ) {
    return this.finops.generateRecommendation(body.resourceId, body.kind, body.savingFraction, body.recommendedDesiredState);
  }

  @ApiOperation({ summary: "Execute a recommendation as a real plan through the pipeline" })
  @Post("recommendations/:id/execute")
  @Permissions("system.finops.execute")
  async execute(@Param("id") id: string) {
    return this.finops.executeRecommendation(id);
  }

  @ApiOperation({ summary: "Measure a recommendation's actual saving against its prediction, showing the difference" })
  @Post("recommendations/:id/measure")
  @Permissions("system.finops.execute")
  async measure(@Param("id") id: string, @Body() body: { actualCostAfter: string }) {
    return this.finops.measureActualSaving(id, body.actualCostAfter);
  }
}
