import { Module } from "@nestjs/common";
import { RealEstateEnterpriseService } from "./services/real-estate-enterprise.service";
import { RealEstateEnterpriseController } from "./controllers/real-estate-enterprise.controller";

@Module({
  controllers: [RealEstateEnterpriseController],
  providers: [RealEstateEnterpriseService],
  exports: [RealEstateEnterpriseService],
})
export class RealEstateEnterpriseModule {}
