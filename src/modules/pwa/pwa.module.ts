import { PwaGeneratedController } from "./controllers/pwa-generated.controller";
import { PwaGeneratedService } from "./services/pwa-generated.service";
import { Module } from "@nestjs/common";
import { PwaController } from "./controllers/pwa.controller";
import { PwaService } from "./services/pwa.service";
import { PwaPushService } from "./services/pwa-push.service";
import { PwaSyncService } from "./services/pwa-sync.service";

import { PwaRepository } from "./repositories/pwa.repository";

@Module({
  controllers: [PwaGeneratedController, PwaController],
  providers: [PwaRepository, PwaGeneratedService, PwaService, PwaPushService, PwaSyncService],
  exports: [PwaRepository, PwaGeneratedService, PwaService, PwaPushService, PwaSyncService],
})
export class PwaModule {}
