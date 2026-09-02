import { Module } from "@nestjs/common";
import { ExtGatewayDeepController } from "./controllers/ext-gateway-deep.controller";
import { ExtGatewayDeepService } from "./services/ext-gateway-deep.service";

@Module({
  controllers: [ExtGatewayDeepController],
  providers: [ExtGatewayDeepService],
  exports: [ExtGatewayDeepService],
})
export class ExtGatewayDeepModule {}
