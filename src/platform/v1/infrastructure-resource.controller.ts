/**
 * M21 — compute, storage and network resources, reachable from the
 * console. Uses M15's own estate search for listing (GET /platform/v1/estate/resources?kind=...)
 * rather than a second list endpoint; this controller owns the
 * kind-specific lifecycle actions M15's generic estate view does not.
 */
import { Controller, Post, Delete, Param, Body, UseGuards } from "@nestjs/common";
import { ApiTags, ApiOperation, ApiBearerAuth } from "@nestjs/swagger";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RbacGuard } from "../../common/guards/rbac.guard";
import { ControlPlaneGuard } from "../../common/guards/control-plane.guard";
import { Permissions } from "../../common/decorators/permissions.decorator";
import { SkipTenantScope } from "../../common/decorators/skip-tenant-scope.decorator";
import { InfrastructureResourceService, type InfrastructureKind } from "./infrastructure-resource.service";

interface ProvisionBody {
  kind: InfrastructureKind;
  name: string;
  initialState: Record<string, unknown>;
}

interface ChangeBody {
  newState: Record<string, unknown>;
}

interface DriftBody {
  observedState: Record<string, unknown>;
}

@ApiTags("platform")
@ApiBearerAuth()
@Controller("platform/v1/infrastructure-resources")
@UseGuards(JwtAuthGuard, RbacGuard, ControlPlaneGuard)
@SkipTenantScope()
export class InfrastructureResourceController {
  constructor(private readonly infra: InfrastructureResourceService) {}

  @ApiOperation({ summary: "Provision a compute, storage or network resource" })
  @Post()
  @Permissions("system.infrastructure.provision")
  async provision(@Body() body: ProvisionBody) {
    return this.infra.provision(body.kind, body.name, body.initialState);
  }

  @ApiOperation({ summary: "Scale or migrate a resource: proposes a plan and applies it as a durable, reversible job" })
  @Post(":id/change")
  @Permissions("system.infrastructure.provision")
  async change(@Param("id") id: string, @Body() body: ChangeBody) {
    return this.infra.changeDesiredState(id, body.newState);
  }

  @ApiOperation({ summary: "Deprovision a resource — refused with dependents named if any depend on it" })
  @Delete(":id")
  @Permissions("system.infrastructure.provision")
  async deprovision(@Param("id") id: string) {
    await this.infra.deprovision(id);
    return { deprovisioned: true };
  }

  @ApiOperation({ summary: "Report an observed state, surfacing drift if it diverges from desired" })
  @Post(":id/observed-state")
  @Permissions("system.infrastructure.provision")
  async reportDrift(@Param("id") id: string, @Body() body: DriftBody) {
    return this.infra.reportDrift(id, body.observedState);
  }
}
