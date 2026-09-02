import { Module } from "@nestjs/common";
import { FreightClaimsService } from "./services/freight-claims.service";
import { FreightClaimsController } from "./controllers/freight-claims.controller";

@Module({
  providers: [FreightClaimsService],
  controllers: [FreightClaimsController],
})
export class FreightClaimsModule {}
