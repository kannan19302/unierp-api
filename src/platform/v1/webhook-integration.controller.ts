/**
 * M41 — HTTP surface for the platform event catalogue and webhook
 * delivery proven in platform-event-bus.service.ts and
 * webhook-delivery.service.ts.
 */
import { Controller, Get, Post, Body, Query, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RbacGuard } from "../../common/guards/rbac.guard";
import { ControlPlaneGuard } from "../../common/guards/control-plane.guard";
import { StepUpMfaGuard } from "../../common/guards/step-up-mfa.guard";
import { SkipTenantScope } from "../../common/decorators/skip-tenant-scope.decorator";
import { Permissions } from "../../common/decorators/permissions.decorator";
import { ApiTags, ApiOperation, ApiBearerAuth } from "@nestjs/swagger";
import { PlatformEventBusService, PLATFORM_EVENT_CATALOG } from "./platform-event-bus.service";
import { HttpWebhookTransport } from "./http-webhook.transport";
import { WebhookDeliveryService } from "./webhook-delivery.service";

interface EmitBody {
  eventType: string;
  payload: Record<string, unknown>;
}

@ApiTags("platform")
@ApiBearerAuth()
@Controller("platform/v1/integrations")
@UseGuards(JwtAuthGuard, RbacGuard, ControlPlaneGuard, StepUpMfaGuard)
@SkipTenantScope()
export class WebhookIntegrationController {
  constructor(
    private readonly events: PlatformEventBusService,
    private readonly delivery: WebhookDeliveryService,
    private readonly transport: HttpWebhookTransport,
  ) {}

  @ApiOperation({ summary: "The documented platform event catalogue" })
  @Get("events/catalog")
  @Permissions("system.integrations.read")
  async catalog() {
    return PLATFORM_EVENT_CATALOG;
  }

  @ApiOperation({ summary: "Replay platform events since a sequence" })
  @Get("events/replay")
  @Permissions("system.integrations.read")
  async replay(@Query("since") since?: string) {
    return this.events.replay(since ? BigInt(since) : 0n);
  }

  @ApiOperation({ summary: "Emit a documented platform event" })
  @Post("events/emit")
  @Permissions("system.integrations.manage")
  async emit(@Body() body: EmitBody) {
    return this.events.emit(body.eventType, body.payload);
  }

  @ApiOperation({ summary: "Deliver a webhook endpoint's backlog, in order" })
  @Post("webhooks/deliver")
  @Permissions("system.integrations.manage")
  async deliver(@Body() body: { endpointId: string }) {
    return this.delivery.deliverBacklog(body.endpointId, this.transport);
  }
}
