import { ExtGatewayGeneratedController } from "./controllers/ext-gateway-generated.controller";
import { ExtGatewayGeneratedService } from "./services/ext-gateway-generated.service";
import { Module } from "@nestjs/common";
import { ExtGatewayController } from "./controllers/ext-gateway.controller";
import { ExtCallbackController } from "./controllers/ext-callback.controller";
import { ServiceRegistryService } from "./services/service-registry.service";
import { TenantTokenService } from "./services/tenant-token.service";
import { ExtProxyService } from "./services/ext-proxy.service";
import { CircuitBreakerService } from "./services/circuit-breaker.service";
import { ExtEventDispatcherService } from "./services/ext-event-dispatcher.service";
import { ExtCallbackService } from "./services/ext-callback.service";

import { ExtGatewayRepository } from "./repositories/ext-gateway.repository";

@Module({
  controllers: [
    ExtGatewayGeneratedController,
    ExtGatewayController,
    ExtCallbackController,
  ],
  providers: [
    ExtGatewayRepository,
    ExtGatewayGeneratedService,
    ServiceRegistryService,
    TenantTokenService,
    ExtProxyService,
    CircuitBreakerService,
    ExtEventDispatcherService,
    ExtCallbackService,
  ],
  exports: [
    ExtGatewayRepository,
    ExtGatewayGeneratedService,
    ServiceRegistryService,
    ExtProxyService,
    ExtEventDispatcherService,
  ],
})
export class ExtGatewayModule {}
