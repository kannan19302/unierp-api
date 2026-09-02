import { Module } from "@nestjs/common";
import { VelocityAbcXyzController } from "./controllers/velocity-abc-xyz.controller";
import { VelocityAbcXyzService } from "./services/velocity-abc-xyz.service";

@Module({
  controllers: [VelocityAbcXyzController],
  providers: [VelocityAbcXyzService],
  exports: [VelocityAbcXyzService],
})
export class VelocityAbcXyzModule {}
