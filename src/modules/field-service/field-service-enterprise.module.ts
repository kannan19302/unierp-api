import { Module } from "@nestjs/common";
import { FieldServiceEnterpriseService } from "./services/field-service-enterprise.service";
import { FieldServiceEnterpriseController } from "./controllers/field-service-enterprise.controller";

@Module({
  controllers: [FieldServiceEnterpriseController],
  providers: [FieldServiceEnterpriseService],
  exports: [FieldServiceEnterpriseService],
})
export class FieldServiceEnterpriseModule {}
