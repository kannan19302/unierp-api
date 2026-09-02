import { DevopsGeneratedController } from "./controllers/devops-generated.controller";
import { DevopsGeneratedService } from "./services/devops-generated.service";
import { Module } from "@nestjs/common";
import { DevopsController } from "./controllers/devops.controller";
import { DevopsService } from "./services/devops.service";
import { DevopsDeepController } from "./controllers/devops-deep.controller";
import { DevopsDeepService } from "./services/devops-deep.service";
import { DevopsDeepV2Controller } from "./controllers/devops-deep-v2.controller";
import { DevopsDeepV2Service } from "./services/devops-deep-v2.service";
import { DevopsDeepV3Controller } from "./controllers/devops-deep-v3.controller";
import { DevopsDeepV3Service } from "./services/devops-deep-v3.service";

import { DevopsRepository } from "./repositories/devops.repository";

@Module({
  controllers: [
    DevopsGeneratedController,
    DevopsController,
    DevopsDeepController,
    DevopsDeepV2Controller,
    DevopsDeepV3Controller,
  ],
  providers: [
    DevopsRepository,
    DevopsGeneratedService,
    DevopsService,
    DevopsDeepService,
    DevopsDeepV2Service,
    DevopsDeepV3Service,
  ],
  exports: [
    DevopsRepository,
    DevopsGeneratedService,
    DevopsService,
    DevopsDeepService,
    DevopsDeepV2Service,
    DevopsDeepV3Service,
  ],
})
export class DevopsModule {}
