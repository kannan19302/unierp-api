import { Module } from "@nestjs/common";
import { HazmatController } from "./controllers/hazmat.controller";
import { HazmatService } from "./services/hazmat.service";

@Module({
  controllers: [HazmatController],
  providers: [HazmatService],
  exports: [HazmatService],
})
export class HazmatModule {}
