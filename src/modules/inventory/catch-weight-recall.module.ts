import { Module } from "@nestjs/common";
import { CatchWeightRecallController } from "./controllers/catch-weight-recall.controller";
import { CatchWeightRecallService } from "./services/catch-weight-recall.service";

@Module({
  controllers: [CatchWeightRecallController],
  providers: [CatchWeightRecallService],
  exports: [CatchWeightRecallService],
})
export class CatchWeightRecallModule {}
