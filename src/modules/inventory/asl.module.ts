import { Module } from "@nestjs/common";
import { AslController } from "./controllers/asl.controller";
import { AslService } from "./services/asl.service";

@Module({
  controllers: [AslController],
  providers: [AslService],
  exports: [AslService],
})
export class AslModule {}
