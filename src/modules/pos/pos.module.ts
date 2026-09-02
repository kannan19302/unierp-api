import { Module } from "@nestjs/common";
import { EventEmitterModule } from "@nestjs/event-emitter";
import { PosController } from "./controllers/pos.controller";
import { PosService } from "./services/pos.service";
import { PosExpansionController } from "./controllers/pos-expansion.controller";
import { PosExpansionService } from "./services/pos-expansion.service";
import { PosRepository } from "./repositories/pos.repository";
import { PosEnterpriseModule } from "./pos-enterprise.module";

@Module({
  imports: [EventEmitterModule, PosEnterpriseModule],
  controllers: [PosController, PosExpansionController],
  providers: [PosRepository, PosService, PosExpansionService],
  exports: [PosRepository, PosService, PosExpansionService],
})
export class PosModule {}
