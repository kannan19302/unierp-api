import { Module } from "@nestjs/common";
import { PickWavesService } from "./services/pick-waves.service";
import { PickWavesController } from "./controllers/pick-waves.controller";

@Module({ providers: [PickWavesService], controllers: [PickWavesController] })
export class PickWavesModule {}
