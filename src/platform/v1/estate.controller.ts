/**
 * M15 — the console's estate view: server-side search across every resource
 * kind (M07), and bulk plans over the results (M15's BulkOperationService).
 * The first plane-1 controller exposing the Track M kernel (M02-M14) to the
 * console at all — every prior Track M phase built a real mechanism with
 * tests, but none of it was reachable over HTTP until this phase. See
 * docs/programme/90-DEFECT-LOG.md for the finding this leaves behind for
 * the rest of Track M's console-facing phases.
 */
import { Controller, Get, Post, Param, Query, Body, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RbacGuard } from "../../common/guards/rbac.guard";
import { ControlPlaneGuard } from "../../common/guards/control-plane.guard";
import { SkipTenantScope } from "../../common/decorators/skip-tenant-scope.decorator";
import { Permissions } from "../../common/decorators/permissions.decorator";
import { ApiTags, ApiOperation, ApiBearerAuth } from "@nestjs/swagger";
import { ResourceModelService } from "../resource-model/resource-model.service";
import { BulkOperationService } from "../operation-pipeline/bulk-operation.service";

interface BulkPlanBody {
  kind: string;
  resourceIds: string[];
  /** Proposed desired-state field changes applied identically to every item. */
  proposedState: Record<string, unknown>;
}

@ApiTags("platform")
@ApiBearerAuth()
@Controller("platform/v1/estate")
@UseGuards(JwtAuthGuard, RbacGuard, ControlPlaneGuard)
@SkipTenantScope()
export class EstateController {
  constructor(
    private readonly resources: ResourceModelService,
    private readonly bulkOperations: BulkOperationService,
  ) {}

  @ApiOperation({ summary: "Search resources across the estate" })
  @Get("resources")
  @Permissions("system.estate.read")
  async search(
    @Query("kind") kindName?: string,
    @Query("q") nameContains?: string,
    @Query("sortBy") sortBy?: "name" | "createdAt",
    @Query("sortDir") sortDir?: "asc" | "desc",
    @Query("cursor") cursor?: string,
    @Query("limit") limit?: string,
  ) {
    return this.resources.searchResources({
      kindName,
      nameContains,
      sortBy,
      sortDir,
      cursor: cursor ? Number(cursor) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @ApiOperation({ summary: "Apply a desired-state change across multiple resources, one item at a time, resumable" })
  @Post("bulk")
  @Permissions("system.estate.bulk")
  async bulk(@Body() body: BulkPlanBody) {
    // Declares desired state per item (M07) rather than driving a provider
    // directly — the same separation M09 establishes for a single resource:
    // this endpoint changes what SHOULD be true, and M12/M13's pipeline and
    // reconciler are what make actual state converge to it.
    return this.bulkOperations.start(body.kind, body.resourceIds, async (resourceId) => {
      await this.resources.setDesiredState(resourceId, body.proposedState);
    });
  }

  @ApiOperation({ summary: "Resume an interrupted bulk operation" })
  @Post("bulk/:id/resume")
  @Permissions("system.estate.bulk")
  async resumeBulk(@Param("id") id: string, @Body() body: BulkPlanBody) {
    return this.bulkOperations.resume(id, async (resourceId) => {
      await this.resources.setDesiredState(resourceId, body.proposedState);
    });
  }
}
