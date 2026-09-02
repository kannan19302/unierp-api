import { Module } from "@nestjs/common";
import { VmiService } from "./services/vmi.service";
import { VmiController } from "./controllers/vmi.controller";

@Module({ providers: [VmiService], controllers: [VmiController] })
export class VmiModule {}
