import { Module } from "@nestjs/common";
import { ContainerPalletController } from "./controllers/container-pallet.controller";
import { ContainerPalletService } from "./services/container-pallet.service";

@Module({
  controllers: [ContainerPalletController],
  providers: [ContainerPalletService],
  exports: [ContainerPalletService],
})
export class ContainerPalletModule {}
