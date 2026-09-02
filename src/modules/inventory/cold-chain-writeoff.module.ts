import { Module } from "@nestjs/common";
import { ColdChainWriteoffController } from "./controllers/cold-chain-writeoff.controller";
import { ColdChainWriteoffService } from "./services/cold-chain-writeoff.service";

@Module({
  controllers: [ColdChainWriteoffController],
  providers: [ColdChainWriteoffService],
  exports: [ColdChainWriteoffService],
})
export class ColdChainWriteoffModule {}
