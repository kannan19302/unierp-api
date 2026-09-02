import { ApiPlatformGeneratedController } from "./controllers/api-platform-generated.controller";
import { ApiPlatformGeneratedService } from "./services/api-platform-generated.service";
import { Module } from "@nestjs/common";
import { ApiPlatformController } from "./controllers/api-platform.controller";
import { ApiPlatformService } from "./services/api-platform.service";
import { ApiRateLimitsService } from "./services/api-rate-limits.service";
import { ApiQuotasService } from "./services/api-quotas.service";
import { ApiPlatformDeepController } from "./controllers/api-platform-deep.controller";
import { ApiPlatformDeepService } from "./services/api-platform-deep.service";
import { ApiPlatformDeepV2Controller } from "./controllers/api-platform-deep-v2.controller";
import { ApiPlatformDeepV2Service } from "./services/api-platform-deep-v2.service";
import { ApiPlatformDeepV3Controller } from "./controllers/api-platform-deep-v3.controller";
import { ApiPlatformDeepV3Service } from "./services/api-platform-deep-v3.service";

import { ApiPlatformRepository } from "./repositories/api-platform.repository";

@Module({
  controllers: [
    ApiPlatformGeneratedController,
    ApiPlatformController,
    ApiPlatformDeepController,
    ApiPlatformDeepV2Controller,
    ApiPlatformDeepV3Controller,
  ],
  providers: [
    ApiPlatformRepository,
    ApiPlatformGeneratedService,
    ApiPlatformService,
    ApiRateLimitsService,
    ApiQuotasService,
    ApiPlatformDeepService,
    ApiPlatformDeepV2Service,
    ApiPlatformDeepV3Service,
  ],
  exports: [
    ApiPlatformRepository,
    ApiPlatformGeneratedService,
    ApiPlatformService,
    ApiRateLimitsService,
    ApiQuotasService,
    ApiPlatformDeepService,
    ApiPlatformDeepV2Service,
    ApiPlatformDeepV3Service,
  ],
})
export class ApiPlatformModule {}
