import { Module } from "@nestjs/common";
import { CrossDockService } from "./services/cross-dock.service";
import { CrossDockController } from "./controllers/cross-dock.controller";

@Module({ providers: [CrossDockService], controllers: [CrossDockController] })
export class CrossDockModule {}
