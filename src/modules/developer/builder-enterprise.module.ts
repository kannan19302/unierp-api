import { Module } from "@nestjs/common";
import { BuilderEnterpriseService } from "./services/builder-enterprise.service";
import { BuilderEnterpriseController } from "./controllers/builder-enterprise.controller";

@Module({
  controllers: [BuilderEnterpriseController],
  providers: [BuilderEnterpriseService],
  exports: [BuilderEnterpriseService],
})
export class BuilderEnterpriseModule {}
