import { Module } from "@nestjs/common";
import { ProjectsEnterpriseController } from "./controllers/projects-enterprise.controller";
import { ProjectsEnterpriseService } from "./services/projects-enterprise.service";

@Module({
  controllers: [ProjectsEnterpriseController],
  providers: [ProjectsEnterpriseService, ProjectsEnterpriseController],
  exports: [ProjectsEnterpriseService],
})
export class ProjectsEnterpriseModule {}
