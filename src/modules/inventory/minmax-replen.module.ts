import { Module } from "@nestjs/common";
import { MinMaxReplenController } from "./controllers/minmax-replen.controller";
import { MinMaxReplenService } from "./services/minmax-replen.service";

@Module({
  controllers: [MinMaxReplenController],
  providers: [MinMaxReplenService],
  exports: [MinMaxReplenService],
})
export class MinMaxReplenModule {}
