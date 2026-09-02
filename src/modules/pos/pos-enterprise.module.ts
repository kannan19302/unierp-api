import { Module } from "@nestjs/common";
import { PosEnterpriseService } from "./services/pos-enterprise.service";
import { PosEnterpriseController } from "./controllers/pos-enterprise.controller";

@Module({
  controllers: [PosEnterpriseController],
  providers: [PosEnterpriseService],
  exports: [PosEnterpriseService],
})
export class PosEnterpriseModule {}
