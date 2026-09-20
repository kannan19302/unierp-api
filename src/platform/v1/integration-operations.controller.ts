import { Controller, Get, Post, Param, Body, UseGuards, Inject } from "@nestjs/common";
import { ApiTags, ApiOperation, ApiBearerAuth } from "@nestjs/swagger";
import {
  PlatformIntegrationOperationsService,
  FieldMappingRule,
  TransformFunction,
} from "./integration-operations.service";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RbacGuard } from "../../common/guards/rbac.guard";
import { ControlPlaneGuard } from "../../common/guards/control-plane.guard";
import { SkipTenantScope } from "../../common/decorators/skip-tenant-scope.decorator";
import { Permissions } from "../../common/decorators/permissions.decorator";

@ApiTags("Platform Integration & Connector Operations (PCC-20)")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RbacGuard, ControlPlaneGuard)
@Controller("platform/v1/integration-operations")
@SkipTenantScope()
export class PlatformIntegrationOperationsController {
  constructor(
    @Inject(PlatformIntegrationOperationsService)
    private readonly service: PlatformIntegrationOperationsService
  ) {}

  // --- 1. Data Mapping Designer (EC-20.1) ---

  @ApiOperation({ summary: "List all visual data entity mappings" })
  @Permissions("system.integrations.read")
  @Get("mappings")
  async listMappings() {
    return this.service.listMappings();
  }

  @ApiOperation({ summary: "Get mapping definition by ID" })
  @Permissions("system.integrations.read")
  @Get("mappings/:id")
  async getMapping(@Param("id") id: string) {
    return this.service.getMapping(id);
  }

  @ApiOperation({ summary: "Save visual data entity mapping" })
  @Permissions("system.integrations.write")
  @Post("mappings")
  async saveMapping(
    @Body()
    body: {
      name: string;
      connectorId: string;
      sourceEntity: string;
      targetEntity: string;
      fieldMappings: FieldMappingRule[];
    }
  ) {
    return this.service.saveMapping(body);
  }

  @ApiOperation({ summary: "Test field mapping rules against sample payload" })
  @Permissions("system.integrations.read")
  @Post("mappings/test")
  async testMapping(
    @Body()
    body: {
      rules: FieldMappingRule[];
      samplePayload: Record<string, unknown>;
    }
  ) {
    return this.service.testMappingTransformation(body.rules, body.samplePayload);
  }

  // --- 2. Sync Schedule Configuration (EC-20.2) ---

  @ApiOperation({ summary: "List recurring sync schedule jobs" })
  @Permissions("system.integrations.read")
  @Get("jobs")
  async listSyncJobs() {
    return this.service.listSyncJobs();
  }

  @ApiOperation({ summary: "Create recurring sync schedule job" })
  @Permissions("system.integrations.write")
  @Post("jobs")
  async createSyncJob(
    @Body()
    body: {
      connectorId: string;
      name: string;
      direction: "ONE_WAY" | "BI_DIRECTIONAL";
      scheduleCron: string;
      conflictStrategy: "SOURCE_WINS" | "TARGET_WINS" | "MANUAL_REVIEW";
      batchSize?: number;
    }
  ) {
    return this.service.createSyncJob(body);
  }

  @ApiOperation({ summary: "Toggle sync job pause/active status" })
  @Permissions("system.integrations.write")
  @Post("jobs/:id/toggle")
  async toggleSyncJob(@Param("id") id: string) {
    return this.service.toggleSyncJobStatus(id);
  }

  // --- 3. Connector Health & Telemetry (EC-20.3) ---

  @ApiOperation({ summary: "List connector health states and latency" })
  @Permissions("system.integrations.read")
  @Get("connectors")
  async listConnectors() {
    return this.service.listConnectors();
  }

  @ApiOperation({ summary: "Trigger real-time health check / ping on connector" })
  @Permissions("system.integrations.write")
  @Post("connectors/:id/ping")
  async pingConnector(@Param("id") id: string) {
    return this.service.triggerConnectorHealthCheck(id);
  }
}
