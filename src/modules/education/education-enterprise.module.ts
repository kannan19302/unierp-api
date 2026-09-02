import { Module } from "@nestjs/common";
import { EducationEnterpriseService } from "./services/education-enterprise.service";
import { EducationEnterpriseController } from "./controllers/education-enterprise.controller";

@Module({
  controllers: [EducationEnterpriseController],
  providers: [EducationEnterpriseService],
  exports: [EducationEnterpriseService],
})
export class EducationEnterpriseModule {}
